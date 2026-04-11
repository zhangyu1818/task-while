export interface AgentInvocation {
  outputSchema: Record<string, unknown>
  prompt: string
  role: string
}

export interface AgentPort {
  execute: (invocation: AgentInvocation) => Promise<unknown>
  name: string
}

export function createRoleInvocation(
  role: string,
  input: Omit<AgentInvocation, 'role'>,
): AgentInvocation {
  return { ...input, role }
}
