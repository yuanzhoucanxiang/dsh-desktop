/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/lib/companion.cordis.yml（单一事实源）
 * Regen:  node scripts/sync-companion-preset.mjs
 * 漂移门禁: plugin/writing-mode/test/companion-preset.mjs
 *
 * 0.1.7 内核不再扫描 ~/.dsh/.agent-presets：preset 改为向 agentPresets 注册表
 * 编程注册（host index.js 的 ensurePresetRegistered）。yml 里的 `!!js` 在此
 * 是加载时求值的活表达式，语义与 cordis-plugin-loader 一致。
 */
export const COMPANION_PRESET_ID = "writing-companion"
export const COMPANION_PRESET_NAME = "写作伙伴"
export const COMPANION_PRESET_DESCRIPTION = "与作者持续交流，按需使用工具与项目资料。"

export const COMPANION_PRESET_PLUGINS = [
  {
    id: "persona",
    name: "@deepseek-ai/dsh-persona",
    config: {
      prefix: "你是由 {{model}} 驱动的 AI 写作伙伴，工作目录是 {{cwd}}。 用自然、真诚的交流陪作者推进作品：聊人物和生活观察、讨论故事、推敲文字、检索资料或一起创作。 跟随作者此刻的需要，不必把每次交流都变成任务、建议清单或评审；作者只是说想法时先理解，可以有不同意见，避免敷衍附和。 不强制阶段、字数配额、固定轮数或多角色流水线。模板、量化检查和分工按需要使用；明确的项目要求仍应遵守。 灵活使用 Harness 提供的上下文、文件、检索、技能和委派能力；简单交流直接回答，工具有助于完成实际请求时再使用。 讨论或粘贴稿件本身不是落盘指令。作者要求执行或修改时自主完成必要步骤；改稿保留旧版本，遇到磁盘与编辑器快照冲突先说明，不覆盖冲突内容。 回复里提到作品内的具体文稿时，用「[[文件名]]」标注（含扩展名，如 [[第1章-v2.md]]；不带版本号写 [[第1章.md]] 也可以），作者点击即可跳到那篇稿；只在确有对应文稿时标注，不要编造文件名。 把作者确认的设定、你提出的建议、推测和查证到的资料分清楚。记不清时查阅项目或坦诚说明，不编造共同经历或永久记忆。 温和但不假扮真人。会话结束后不会自行监听、主动联系作者或后台持续陪伴。",
      text: "你是由 {{model}} 驱动的 AI 写作伙伴，工作目录是 {{cwd}}。 用自然、真诚的交流陪作者推进作品：聊人物和生活观察、讨论故事、推敲文字、检索资料或一起创作。 跟随作者此刻的需要，不必把每次交流都变成任务、建议清单或评审；作者只是说想法时先理解，可以有不同意见，避免敷衍附和。 不强制阶段、字数配额、固定轮数或多角色流水线。模板、量化检查和分工按需要使用；明确的项目要求仍应遵守。 灵活使用 Harness 提供的上下文、文件、检索、技能和委派能力；简单交流直接回答，工具有助于完成实际请求时再使用。 讨论或粘贴稿件本身不是落盘指令。作者要求执行或修改时自主完成必要步骤；改稿保留旧版本，遇到磁盘与编辑器快照冲突先说明，不覆盖冲突内容。 回复里提到作品内的具体文稿时，用「[[文件名]]」标注（含扩展名，如 [[第1章-v2.md]]；不带版本号写 [[第1章.md]] 也可以），作者点击即可跳到那篇稿；只在确有对应文稿时标注，不要编造文件名。 把作者确认的设定、你提出的建议、推测和查证到的资料分清楚。记不清时查阅项目或坦诚说明，不编造共同经历或永久记忆。 温和但不假扮真人。会话结束后不会自行监听、主动联系作者或后台持续陪伴。"
    }
  },
  {
    id: "agent-instructions",
    name: "@deepseek-ai/dsh-agent-instructions",
    config: {
      maxBytes: 65536
    }
  },
  {
    id: "tool-bash",
    name: "@deepseek-ai/dsh-tool-bash",
    disabled: process.platform === 'win32'
  },
  {
    id: "tool-pwsh",
    name: "@deepseek-ai/dsh-tool-pwsh",
    disabled: process.platform !== 'win32'
  },
  {
    id: "tool-fs",
    name: "@deepseek-ai/dsh-tool-fs"
  },
  {
    id: "tool-fs-search",
    name: "@deepseek-ai/dsh-tool-fs-search",
    config: {
      sampleOverCapGlobResults: false
    }
  },
  {
    id: "tool-jobs",
    name: "@deepseek-ai/dsh-tool-jobs"
  },
  {
    id: "skill-filesystem",
    name: "@deepseek-ai/dsh-skill-filesystem"
  },
  {
    id: "tool-skill",
    name: "@deepseek-ai/dsh-tool-skill"
  },
  {
    id: "command-goal",
    name: "@deepseek-ai/dsh-command-goal"
  },
  {
    id: "tool-goal",
    name: "@deepseek-ai/dsh-tool-goal"
  },
  {
    id: "planning",
    name: "cordis:group",
    group: true,
    isolate: {
      planMode: true
    },
    config: [
      {
        id: "plan-mode",
        name: "@deepseek-ai/dsh-plan-mode",
        config: {
          section: "You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.\n\nExplore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.\n\nThe tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.\n\nResolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.\n\nMake the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.\n\nWhen ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask \"should I proceed?\" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.\n"
        }
      }
    ]
  },
  {
    id: "compaction",
    name: "cordis:group",
    group: true,
    isolate: {
      compaction: true,
      toolResultPruner: true
    },
    config: [
      {
        id: "compaction-basic",
        name: "@deepseek-ai/dsh-compaction-basic"
      },
      {
        id: "command-compact",
        name: "@deepseek-ai/dsh-command-compact"
      },
      {
        id: "tool-result-pruner",
        name: "@deepseek-ai/dsh-compaction-tool-result-pruner",
        config: {
          thresholdChars: 8192,
          headChars: 4096,
          tailChars: 1024
        }
      }
    ]
  },
  {
    id: "delegation",
    name: "cordis:group",
    group: true,
    isolate: {
      workflowEngine: true
    },
    config: [
      {
        id: "tool-subagent-control",
        name: "@deepseek-ai/dsh-tool-subagent-control"
      },
      {
        id: "tool-subagent-list-agents",
        name: "@deepseek-ai/dsh-tool-subagent-control/list-agents"
      },
      {
        id: "tool-subagent",
        name: "@deepseek-ai/dsh-tool-subagent",
        config: {
          provider: "spawn",
          toolName: "subagent",
          modelSelectionSettings: true,
          backgroundMode: "continuable"
        }
      },
      {
        id: "tool-subagent-fork",
        name: "@deepseek-ai/dsh-tool-subagent",
        config: {
          provider: "fork",
          toolName: "subagent_fork",
          backgroundMode: "continuable"
        }
      },
      {
        id: "tool-subagent-codex",
        name: "@deepseek-ai/dsh-tool-subagent",
        disabled: true,
        config: {
          provider: "codex",
          toolName: "subagent_codex",
          backgroundMode: "one-shot",
          maxDepth: "provider-managed"
        }
      },
      {
        id: "tool-subagent-claude-code",
        name: "@deepseek-ai/dsh-tool-subagent",
        disabled: true,
        config: {
          provider: "claude-code",
          toolName: "subagent_claude_code",
          backgroundMode: "one-shot",
          maxDepth: "provider-managed"
        }
      },
      {
        id: "workflow-ptc",
        name: "@deepseek-ai/dsh-workflow-ptc",
        config: {
          provider: "spawn"
        }
      },
      {
        id: "tool-workflow",
        name: "@deepseek-ai/dsh-tool-workflow"
      },
      {
        id: "tool-ralph",
        name: "@deepseek-ai/dsh-tool-ralph",
        disabled: true,
        config: {
          subagentProvider: "spawn",
          maxRounds: 64
        }
      }
    ]
  },
  {
    id: "tool-ask-user",
    name: "@deepseek-ai/dsh-tool-ask-user"
  },
  {
    id: "tool-todo",
    name: "@deepseek-ai/dsh-tool-todo",
    config: {
      allowParallelInProgress: true
    }
  },
  {
    id: "tool-web",
    name: "@deepseek-ai/dsh-tool-web",
    config: {
      fetch: true,
      searchTimeoutMs: 60000
    }
  },
  {
    id: "present",
    name: "@deepseek-ai/dsh-tool-present"
  },
  {
    id: "tool-plugin-manager",
    name: "@deepseek-ai/dsh-plugin-manager/tools",
    disabled: true
  }
]

export const COMPANION_PRESET = {
  id: COMPANION_PRESET_ID,
  name: COMPANION_PRESET_NAME,
  description: COMPANION_PRESET_DESCRIPTION,
  plugins: COMPANION_PRESET_PLUGINS,
}
