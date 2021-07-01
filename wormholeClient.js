const aws4 = require('aws4')
const awscred = require('awscred')

const AWS_REGION = 'us-east-2'
const SOCKET_HOST = '5ds6ld8xpf'
const ENV = 'cdunn'
const WEBSOCKET_URL = `${SOCKET_HOST}.execute-api.${AWS_REGION}.amazonaws.com`

awscred.load(function(err, data) {
  if (err) throw err
  console.log(data.credentials.sessionToken)
  const { path } = aws4.sign(
    {
      host: WEBSOCKET_URL,
      path:
        `/${ENV}` +
        (data.credentials.sessionToken
          ? `?X-Amz-Security-Token=${encodeURIComponent(
              data.credentials.sessionToken,
            )}`
          : ''),
      service: `execute-api`,
      region: AWS_REGION,
      signQuery: true,
    },
    data.credentials,
  )

  console.log(`wss://${WEBSOCKET_URL}${path}`)
})
