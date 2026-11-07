/**
 * Things the overlay can ask a source to do back to the world. Live sources
 * map these to Herdr `pane.focus`, `agent.prompt` and `agent.send_keys`;
 * mock and replay sources do nothing.
 */
export interface Action {
  /** Focus a pane (Herdr `pane.focus`). */
  focus(paneId: string): Promise<void>;
  /** Type a prompt into an agent pane (Herdr `agent.prompt`). */
  prompt(paneId: string, text: string): Promise<void>;
  /** Send key names to an agent pane (Herdr `agent.send_keys`). */
  sendKeys(paneId: string, keys: string[]): Promise<void>;
}

/** Used by sources that have nothing to act on (mock, replay). */
export const NOOP_ACTION: Action = {
  async focus() {},
  async prompt() {},
  async sendKeys() {},
};
