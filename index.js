require('dotenv').config()

const express = require('express')
const axios = require('axios')
const QRCode = require('qrcode')

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys')

const P = require('pino')

const app = express()
app.use(express.json())

const MP_TOKEN = process.env.MP_TOKEN
let qrAtual = ''
let sockGlobal = null
const pagamentos = {}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        defaultQueryTimeoutMs: 60000
    })

    sockGlobal = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        console.log('STATUS:', connection)

        if (qr) {
            qrAtual = await QRCode.toDataURL(qr)
            console.log('✅ QR CODE GERADO')
        }

        if (connection === 'open') {
            console.log('✅ WHATSAPP CONECTADO')
        }

        if (connection === 'close') {
            console.log('❌ DESCONECTADO')

            const reason = lastDisconnect?.error?.output?.statusCode

            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 RECONECTANDO...')
                startBot()
            }
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]

        if (!msg.message) return

        const texto =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text

        if (!texto) return

        const jid = msg.key.remoteJid

        console.log('📩', texto)

        if (texto.toLowerCase() === 'menu') {
            await sock.sendMessage(jid, {
                text:
`🤖 BOT PIX ONLINE

Digite:

pagar 10
pagar 20
pagar 50`
            })
            return
        }

        if (texto.toLowerCase().startsWith('pagar')) {
            const valor = texto.split(' ')[1]

            if (!valor) {
                await sock.sendMessage(jid, {
                    text:
`❌ Use assim:

pagar 10`
                })
                return
            }

            if (Number(valor) < 1) {
                await sock.sendMessage(jid, {
                    text: '❌ Valor inválido.'
                })
                return
            }

            try {
                const pagamento = await axios.post(
                    'https://api.mercadopago.com/v1/payments',
                    {
                        transaction_amount: Number(valor),
                        description: 'Pagamento WhatsApp',
                        payment_method_id: 'pix',
                        payer: {
                            email: 'cliente@email.com',
                            first_name: 'Cliente'
                        }
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${MP_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                )

                const dados = pagamento.data
                const paymentId = dados.id

                pagamentos[paymentId] = jid

                const copiaCola =
                    dados.point_of_interaction.transaction_data.qr_code

                const qrBase64 =
                    dados.point_of_interaction.transaction_data.qr_code_base64

                await sock.sendMessage(jid, {
                    image: Buffer.from(qrBase64, 'base64'),
                    caption:
`💰 PIX GERADO

💵 Valor:
R$${valor}

📋 PIX COPIA E COLA:

${copiaCola}

⏳ Aguardando pagamento...`
                })

                console.log('✅ PIX GERADO:', paymentId)

            } catch (err) {
                console.log('❌ ERRO MERCADO PAGO:')
                console.log(err.response?.data || err.message)

                await sock.sendMessage(jid, {
                    text:
`❌ Erro ao gerar PIX

Confira:
- Access Token Mercado Pago
- Conta Mercado Pago ativa
- Valor correto`
                })
            }
        }
    })
}

app.post('/webhook', async (req, res) => {
    try {
        const id = req.body?.data?.id

        if (!id) {
            return res.sendStatus(200)
        }

        const consulta = await axios.get(
            `https://api.mercadopago.com/v1/payments/${id}`,
            {
                headers: {
                    Authorization: `Bearer ${MP_TOKEN}`
                }
            }
        )

        const pagamento = consulta.data

        if (pagamento.status === 'approved') {
            const jid = pagamentos[id]

            if (jid && sockGlobal) {
                await sockGlobal.sendMessage(jid, {
                    text:
`✅ PAGAMENTO APROVADO

Obrigado pela compra ❤️`
                })
            }

            console.log('✅ PAGAMENTO APROVADO:', id)
        }

        res.sendStatus(200)

    } catch (err) {
        console.log('❌ ERRO WEBHOOK:', err.response?.data || err.message)
        res.sendStatus(500)
    }
})

app.get('/', (req, res) => {
    if (!qrAtual) {
        return res.send('<h2>Aguarde QR Code...</h2>')
    }

    res.send(`
    <html>
    <body style="text-align:center;font-family:Arial">
        <h2>ESCANEIE O QR CODE</h2>
        <img src="${qrAtual}" width="300"/>
    </body>
    </html>
    `)
})

app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 SERVIDOR ONLINE')
})

startBot()
