import { defineConfig } from 'prisma/config'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})
// import { defineConfig } from 'prisma/config'
// import { execSync } from 'child_process'
// import * as fs from 'fs'
// import * as path from 'path'

// // Manually parse .env since process.env isn't populated yet
// const envPath = path.resolve(__dirname, '../.env') 
// if (fs.existsSync(envPath)) {
//   const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
//   for (const line of lines) {
//     const match = line.match(/^([^#=]+)=(.*)$/)
//     if (match) process.env[match[1].trim()] = match[2].trim()
//   }
// }

// export default defineConfig({
//   datasource: {
//     url: process.env.DATABASE_URL as string,
//   },
// })
