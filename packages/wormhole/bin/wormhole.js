#!/usr/bin/env node

const { Command } = require('commander')
const { wsListen, listConnections } = require('./wormholeCommands')

const parseNumber = (value, dummyPrevious) => {
  const parsedValue = parseInt(value, 10)
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.')
  }
  return parsedValue
}

async function main() {
  const program = new Command()

  program.version('0.2.1')

  program
    .command('listen')
    .description('listen websocket connections')
    .argument('<endpoint>', 'HTTPS API Gateway endpoint')
    .argument('<local port>', 'local port to proxy requests against', parseNumber)
    .option(
      '-l, --localhost <host>',
      'local hostname to proxy against',
      'localhost',
    )
    .option('-s, --scheme <scheme>', 'local scheme to proxy against', 'http')
    .option('-m, --max-ws-size <maxWsSize>', 'maximum websocket filesize before using s3 proxy regardless of cache-control header', parseNumber)
    .option('-t, --session-timeout <sessionTimeout>', 'max seconds before closing websocket connection', parseNumber)
    .option('-d, --debug', 'output extra debugging')
    .option('-f, --force', 'force delete existing client connection for host if present')
    .action(async (endpoint, localPort, options) => {
      await wsListen(endpoint, localPort, options)
    })

  program
    .command('connections')
    .description('list websocket connections')
    .argument('<endpoint>', 'HTTPS API Gateway endpoint')
    .option('-d, --debug', 'output extra debugging')
    .action(async (endpoint, options) => {
      await listConnections(endpoint, options)
    })

  await program.parseAsync(process.argv)
}

if (process.env.NODE_ENV !== 'test') {
  ;(async () => {
    await main()
  })()
}
