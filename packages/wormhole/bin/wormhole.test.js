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
    S3: jest.fn(),
    DynamoDB: {
      DocumentClient: jest.fn(),
    },
  }
})
const { DynamoDB, S3 } = require('aws-sdk')
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

describe('wsListen', () => {
  const endpoint = 'https://wormholeapigateway.com'

  beforeEach(() => {
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
  })

  test('single frame', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
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
        ping: jest.fn(),
        send: jest.fn().mockImplementationOnce(async (payload) => {
          expect(payload).toEqual(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: 'SERVER_CONNECTION_ID',
              data: {
                reqId: 'REQUESTID',
                res: {
                  status: 200,
                  headers: {
                    'cache-control': 'public',
                    'content-type': 'text/plain',
                    'content-length': 10,
                  },
                  s3Key: null,
                  body: 'aGVsbG8gd29ybGQ=',
                },
              },
            }),
          )
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

  test('304', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
        mockReadable.end()
      })

      return new Promise((resolve) =>
        resolve({
          status: 304,
          headers: {
            'cache-control': 'public',
            'content-type': 'text/plain',
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
        ping: jest.fn(),
        send: jest.fn().mockImplementationOnce(async (payload) => {
          expect(payload).toEqual(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: 'SERVER_CONNECTION_ID',
              data: {
                reqId: 'REQUESTID',
                res: {
                  status: 304,
                  headers: {
                    'cache-control': 'public',
                    'content-type': 'text/plain',
                  },
                  s3Key: null,
                  body: null,
                },
              },
            }),
          )
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

  test('s3', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
        mockReadable.end()
      })

      return new Promise((resolve) =>
        resolve({
          status: 200,
          headers: {
            'cache-control': 'public',
            'content-type': 'text/css',
          },
          data: mockReadable,
        }),
      )
    })

    S3.mockImplementation(() => {
      return {
        upload: jest.fn().mockImplementationOnce((args) => {
          expect(args).toEqual(
            expect.objectContaining({
              Bucket: 'S3BUCKET',
              CacheControl: 'public',
              ContentType: 'text/css',
              Key: 'responses/REQUESTID',
            }),
          )
          return {
            promise: () => {
              return new Promise((resolve) =>
                resolve({
                  Key: 's3/KEY',
                }),
              )
            },
          }
        }),
      }
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
        ping: jest.fn(),
        send: jest.fn().mockImplementationOnce(async (payload) => {
          expect(payload).toEqual(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: 'SERVER_CONNECTION_ID',
              data: {
                reqId: 'REQUESTID',
                res: {
                  status: 200,
                  headers: {
                    'cache-control': 'public',
                    'content-type': 'text/css',
                  },
                  s3Key: 's3/KEY',
                  body: null,
                },
              },
            }),
          )
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

  test('s3 with etag', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
        mockReadable.end()
      })

      return new Promise((resolve) =>
        resolve({
          status: 200,
          headers: {
            'cache-control': 'public',
            etag: 'ETAG',
            'content-type': 'text/css',
          },
          data: mockReadable,
        }),
      )
    })

    S3.mockImplementation(() => {
      return {
        headObject: jest.fn().mockImplementationOnce((args) => {
          expect(args).toEqual(
            expect.objectContaining({
              Bucket: 'S3BUCKET',
              Key:
                'responses/acbe2a1132686183c273dbc883beafc69ba0e61c72fdd356929b207a31353143',
            }),
          )
          return {
            promise: () => {
              return new Promise((resolve) =>
                resolve({
                  Key:
                    'responses/acbe2a1132686183c273dbc883beafc69ba0e61c72fdd356929b207a31353143',
                  ContentLength: 10,
                }),
              )
            },
          }
        }),
      }
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
        ping: jest.fn(),
        send: jest.fn().mockImplementationOnce(async (payload) => {
          expect(payload).toEqual(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: 'SERVER_CONNECTION_ID',
              data: {
                reqId: 'REQUESTID',
                res: {
                  status: 200,
                  headers: {
                    'cache-control': 'public',
                    etag: 'ETAG',
                    'content-type': 'text/css',
                  },
                  s3Key:
                    'responses/acbe2a1132686183c273dbc883beafc69ba0e61c72fdd356929b207a31353143',
                  body: null,
                },
              },
            }),
          )
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

  test('private chunked', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
        mockReadable.end()
      })

      return new Promise((resolve) =>
        resolve({
          status: 200,
          headers: {
            'cache-control': 'private',
            'content-type': 'text/js',
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
      let sendFn = jest.fn()
      sendFn.mockImplementationOnce(async (payload) => {
        expect(payload).toEqual(
          JSON.stringify({
            action: 'sendmessage',
            connectionId: 'SERVER_CONNECTION_ID',
            data: {
              reqId: 'REQUESTID',
              bodyChunkIndex: 0,
              bodyChunk: 'aGVsbG8gd29ybGQ=',
              endBodyChunk: true,
              totalChunks: 1,
              res: {
                status: 200,
                headers: {
                  'cache-control': 'private',
                  'content-type': 'text/js',
                },
              },
            },
          }),
        )
        done()
      })
      return {
        addEventListener: wsOnMock,
        ping: jest.fn(),
        send: sendFn,
      }
    })

    wsListen(endpoint, 3000, {
      localhost: 'localhost',
      scheme: 'https',
      debug: true,
    })
  })

  test('maxWsSizeExceeded exceeded', (done) => {
    const mockReadable = new PassThrough()

    axios.mockImplementationOnce((params) => {
      setTimeout(() => {
        mockReadable.emit('data', 'hello world')
        mockReadable.end()
      })

      return new Promise((resolve) =>
        resolve({
          status: 200,
          headers: {
            'cache-control': 'private',
            'content-type': 'text/js',
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
      let sendFn = jest.fn()
      sendFn.mockImplementationOnce(async (payload) => {
        expect(payload).toEqual(
          JSON.stringify({
            action: 'sendmessage',
            connectionId: 'SERVER_CONNECTION_ID',
            data: {
              reqId: 'REQUESTID',
              res: {
                status: 200,
                headers: {
                  'cache-control': 'private',
                  'content-type': 'text/js',
                },
                s3Key: 's3/KEY',
                body: null,
              },
            },
          }),
        )
        done()
      })
      return {
        addEventListener: wsOnMock,
        ping: jest.fn(),
        send: sendFn,
      }
    })

    S3.mockImplementation(() => {
      return {
        upload: jest.fn().mockImplementationOnce((args) => {
          expect(args).toEqual(
            expect.objectContaining({
              Bucket: 'S3BUCKET',
              CacheControl: 'private',
              ContentType: 'text/js',
              Key: 'responses/REQUESTID',
            }),
          )
          return {
            promise: () => {
              return new Promise((resolve) =>
                resolve({
                  Key: 's3/KEY',
                }),
              )
            },
          }
        }),
      }
    })

    wsListen(endpoint, 3000, {
      localhost: 'localhost',
      scheme: 'https',
      debug: true,
      maxWsSize: 0,
    })
  })
})
