import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import { RuntimeAdapter } from './RuntimeAdapter';

export interface LLMRequest {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  error?: string;
}

export interface ILLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export class ClaudeCLILLMClient implements ILLMClient {
  private runtime: RuntimeAdapter;

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const sessionId = uuidv4();
    let content = '';
    let stderrContent = '';
    let finished = false;
    let error: string | undefined;

    return new Promise<LLMResponse>((resolve) => {
      const cleanup = this.runtime.onSessionEvent((data) => {
        if (data.sessionId !== sessionId) return;

        const event = data.event;

        // Capture stderr for debugging
        if (event.type === 'system' && event.subtype === 'stderr') {
          stderrContent += event.content || '';
          return;
        }

        // Collect assistant text from streaming events
        if (event.type === 'assistant' && event.message) {
          const text = this.extractText(event.message);
          if (text) content += text;
        }
        if (event.type === 'content_block_start' && event.content_block) {
          if (event.content_block.type === 'text' && event.content_block.text) {
            content += event.content_block.text;
          }
        }
        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            content += event.delta.text;
          }
        }

        // CLI result event (subtype: 'success') — extract result text
        if (event.type === 'result' && event.subtype === 'success') {
          if (event.result && !content) {
            content = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
          }
          // Don't resolve yet — wait for process close to confirm
          return;
        }

        // Process close event (subtype: 'close' or 'error')
        if (event.type === 'result' && (event.subtype === 'close' || event.subtype === 'error')) {
          if (finished) return;
          finished = true;
          cleanup();

          if (event.subtype === 'error') {
            const errMsg = stderrContent.trim() || event.error || `LLM session exited with code ${event.exitCode}`;
            console.error(`[LLMClient] stderr: ${stderrContent.trim()}`);
            error = errMsg;
          }

          resolve(error ? { content: '', error } : { content });
        }
      });

      this.runtime.startSession({
        sessionId,
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        workingDirectory: os.homedir(),
        noTools: true,
      }).catch((err) => {
        if (!finished) {
          finished = true;
          cleanup();
          resolve({ content: '', error: String(err) });
        }
      });
    });
  }

  private extractText(message: any): string {
    if (!message.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
    }
    return '';
  }
}
