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
    const buildFinalResponse = (prompt) => {
      const filePathMatch = prompt.match(/File path: (.+)/)
      const filePath = filePathMatch ? filePathMatch[1].trim() : 'unknown'
      return JSON.stringify({
        summary: 'processed:' + filePath,
      })
    }

    return {
      async run(prompt) {
        return {
          finalResponse: buildFinalResponse(prompt),
        }
      },
      async runStreamed(prompt) {
        const finalResponse = buildFinalResponse(prompt)
        return {
          events: (async function* () {
            yield { thread_id: 'thread-smoke', type: 'thread.started' }
            yield { type: 'turn.started' }
            yield {
              type: 'item.completed',
              item: {
                type: 'agent_message',
                text: finalResponse,
              },
            }
            yield {
              type: 'turn.completed',
              usage: {
                cached_input_tokens: 0,
                input_tokens: 1,
                output_tokens: 1,
              },
            }
          })(),
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
