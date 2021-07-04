const aws4 = require('aws4')
const awscred = require('awscred')
const { program } = require('commander')
const WebSocket = require('ws')
const https = require('https')
const queryString = require('query-string')
const axios = require('axios')
// const WsStream = require('wstunnel/lib/WsStream')
// const ClientConn = require('wstunnel/lib/httptunnel/ClientConn')
// const bindStream = require('wstunnel/lib/bindStream')

// https://kkf5qj7nzf.execute-api.us-east-2.amazonaws.com/wormholeConfig

// console.log(WsStream)
// const httpConn = new ClientConn('http://localhost:3000')
// console.log(httpConn)
// httpConn.connect({}, (err) => {
//   console.log(err)
// })

function parsePort(value, dummyPrevious) {
  const parsedValue = parseInt(value, 10)
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.')
  }
  return parsedValue
}

async function main() {
  program
    .option('-d, --debug', 'output extra debugging')
    .requiredOption(
      '-p, --port <port>',
      'local port to proxy requests against',
      parsePort,
    )
    .requiredOption('-e, --endpoint <https endpoint>', 'API Gateway endpoint')
    .version('0.0.1')

  await program.parseAsync(process.argv)

  const { endpoint, port } = program.opts()

  const endpointUrl = new URL(endpoint)

  console.log('Fetching wormhole config')
  const wormholeConfigUrl = `https://${endpointUrl.host}/wormholeConfig`
  try {
    const {
      data: { wsEndpoint, wsBucket },
    } = await axios.get(wormholeConfigUrl)
    console.log(
      'Found websocket endpoint %s and bucket %s',
      wsEndpoint,
      wsBucket,
    )

    const wsEndpointUrl = new URL(wsEndpoint)

    console.log('Loading AWS credentials')
    awscred.load(function (err, data) {
      if (err) throw err

      var queryStringStr = queryString.stringify({
        'X-Amz-Security-Token': data.credentials.sessionToken,
        clientType: 'CLIENT',
        clientForHost: endpointUrl.host,
      })

      const { path } = aws4.sign(
        {
          host: wsEndpointUrl.host,
          path: `${wsEndpointUrl.pathname}?` + queryStringStr,
          service: `execute-api`,
          region: data.region,
          signQuery: true,
        },
        data.credentials,
      )

      const signedWsEndpoint = `wss://${wsEndpointUrl.host}${path}`
      console.log('Connecting to websocket')

      const ws = new WebSocket(signedWsEndpoint)
      ws.on('open', () => {
        console.log('Connected to websocket')
      })
      ws.on('close', () => {
        console.log('Disconnected from websocket')
      })
      ws.on('message', async (data) => {
        try {
          const parsedMessage = JSON.parse(data)
          console.log('Received message from websocket', parsedMessage)
          const { sourceConnectionId } = parsedMessage
          // await axios({
          //   method: 'post',
          //   url: '/login',
          //   timeout: 10000,
          //   data: {
          //     firstName: 'David',
          //     lastName: 'Pollock',
          //   },
          // })
          ws.send(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: sourceConnectionId,
              data: {
                pong: true,
              },
            }),
          )
        } catch (e) {
          console.error(e)
        }
      })
    })
  } catch (e) {
    console.error(
      'Error fetching wormhole config. Expected config at %s (%s)',
      wormholeConfigUrl,
      e.message,
    )
  }
}

;(async () => {
  await main()
})()

// const duplex = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
// duplex.pipe(process.stdout)
// process.stdin.pipe(duplex)
