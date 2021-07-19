const path = require('path')
const exec = require('child_process').exec
const axios = require('axios')
const WebSocket = require('ws')
const aws4 = require('aws4')
const awscred = require('awscred')
const { listConnections, wsListen } = require('./wormholeCommands')
const { PassThrough } = require('stream')
const { Readable } = require('stream')

jest.mock('ws')
jest.mock('awscred')
jest.mock('aws4')

jest.mock('aws-sdk', () => {
  return {
    ...jest.requireActual('aws-sdk'),
    DynamoDB: {
      DocumentClient: jest.fn(),
    },
  }
})
const { DynamoDB } = require('aws-sdk')
jest.mock('axios')

beforeEach(() => {
  awscred.load.mockImplementation((cb) => {
    cb(null, {
      credentials: {},
    })
  })
  aws4.sign.mockReturnValue({ path: '/signedPath?signature=v3' })
})

test('listConnections', async () => {
  const endpoint = 'https://wormholeapigateway.com'
  DynamoDB.DocumentClient.mockImplementation(() => {
    return {
      scan(obj) {
        expect(obj).toEqual(
          expect.objectContaining({
            TableName: 'WormholeConnectionsTable',
          }),
        )
        return {
          promise: () => {
            return new Promise((resolve) =>
              resolve({
                Items: [
                  {
                    connectionId: '123',
                  },
                ],
              }),
            )
          },
        }
      },
    }
  })
  axios.get.mockImplementationOnce(() =>
    Promise.resolve({
      data: {
        wsEndpoint: 'ws://websocketendpoint.com',
        bucket: 'S3BUCKET',
        region: 'REGION',
        host: 'host.com',
        table: 'WormholeConnectionsTable',
      },
    }),
  )
  await listConnections(endpoint, { debug: true })
})

const mockReadStream = jest.fn().mockImplementation(() => {
  const readable = new Readable()
  readable.push('hello')
  readable.push('world')
  readable.push(null)

  return readable
})

const mockFile = jest.fn().mockImplementation(() => {
  return {
    createReadStream: mockReadStream,
  }
})

test('wsListen', (done) => {
  const endpoint = 'https://wormholeapigateway.com'
  DynamoDB.DocumentClient.mockImplementationOnce(() => {
    return {
      query(obj) {
        expect(obj).toEqual(
          expect.objectContaining({
            TableName: 'WormholeConnectionsTable',
            IndexName: 'byClientForHost',
            KeyConditionExpression: 'clientForHost = :clientForHost',
          }),
        )
        return {
          promise: () => {
            return new Promise((resolve) => resolve({ Items: [] }))
          },
        }
      },
    }
  })

  axios.get.mockImplementationOnce(() =>
    Promise.resolve({
      data: {
        wsEndpoint: 'ws://websocketendpoint.com',
        bucket: 'S3BUCKET',
        region: 'REGION',
        host: 'host.com',
        table: 'WormholeConnectionsTable',
      },
    }),
  )

  const mockReadable = new PassThrough()

  axios.mockImplementationOnce((params) => {
    setTimeout(() => {
      mockReadable.emit('data', 'hello world');
      mockReadable.end()
    })

    return new Promise((resolve) =>
      resolve({
        status: 200,
        headers: {
          'cache-control': 'public',
          'content-type': 'text/plain',
          'content-length': 10,
        },
        data: mockReadable,
      }),
    )
  })

  let wsOnMock = jest.fn()
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe('open')
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe('close')
  })
  wsOnMock.mockImplementationOnce(async (event, cb) => {
    expect(event).toBe('message')

    await cb({
      data: JSON.stringify({
        sourceConnectionId: 'SERVER_CONNECTION_ID',
        data: {
          req: {
            method: 'GET',
            originalUrl: '/test',
            sourceIp: '1.1.1.1',
            headers: {},
          },
          reqId: 'REQUESTID',
        },
      }),
    })
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe('pong')
  })
  WebSocket.mockImplementation(() => {
    return {
      addEventListener: wsOnMock,
      send: jest.fn().mockImplementationOnce(async (payload) => {
        expect(payload).toEqual(JSON.stringify({
          action:"sendmessage",
          connectionId:"SERVER_CONNECTION_ID",
          data: {
            reqId:"REQUESTID",
            res: {
              status:200,
              headers:{
                "cache-control":"public",
                "content-type":"text/plain",
                "content-length":10
              },
              "s3Key":null,
              "body":"aGVsbG8gd29ybGQ="
            }
          }
        }))
        done()
      }),
    }
  })

  wsListen(endpoint, 3000, {
    localhost: 'localhost',
    scheme: 'https',
    debug: true,
  })
})

// function cli(args, cwd) {
//   return new Promise((resolve) => {
//     exec(
//       `node ${path.resolve('./bin/wormhole.js')} ${args.join(' ')}`,
//       { cwd },
//       (error, stdout, stderr) => {
//         resolve({
//           code: error && error.code ? error.code : 0,
//           error,
//           stdout,
//           stderr,
//         })
//       },
//     )
//   })
// }
