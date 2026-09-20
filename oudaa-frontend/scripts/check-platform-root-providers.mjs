import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('src/main.jsx')
const source = fs.readFileSync(file, 'utf8')

const platformBlock = source.match(/function RootProviders\(\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
if (!platformBlock.includes('if (PLATFORM_ONLY_BUILD)')) {
  throw new Error('PLATFORM_ONLY_BUILD guard is missing from RootProviders')
}
if (!platformBlock.includes('return <App />')) {
  throw new Error('Platform-only RootProviders must render App without the community Auth-dependent providers')
}

console.log('Platform-only RootProviders check passed')
