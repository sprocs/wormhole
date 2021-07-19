const NodeCache = require('node-cache')

const wormholeCache = new NodeCache({ stdTTL: 100 })

module.exports = {
  wormholeCache,
}
