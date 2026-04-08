import { registerHooks } from 'node:module'

const mockCodexSdkUrl = 'while:mock-codex-sdk'

registerHooks({
  load(url, context, nextLoad) {
    if (url === mockCodexSdkUrl) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
export class Codex {
  startThread() {
    return {
      async run(prompt) {
        const filePathMatch = prompt.match(/File path: (.+)/)
        const filePath = filePathMatch ? filePathMatch[1].trim() : 'unknown'
        return {
          finalResponse: JSON.stringify({
            summary: 'processed:' + filePath,
          }),
        }
      },
    }
  }
}
`,
      }
    }
    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openai/codex-sdk') {
      return {
        shortCircuit: true,
        url: mockCodexSdkUrl,
      }
    }
    return nextResolve(specifier, context)
  },
})
