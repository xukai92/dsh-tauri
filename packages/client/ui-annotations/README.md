# @deepseek-ai/dsh-client-ui-annotations

Per-message text-annotation plugin, browser half: an `annotate` entry (order 20) in the `conversation.chat.assistant-actions` strip, plus a `submit-annotations` entry in the composer's `conversation.input.right` seat before the primary send button.

The `annotate` action captures the current text selection (read on `mousedown`, before the click clears it) and opens an inline editor for the quoted text plus a comment. Both fields are editable, so a selection lost to the pointer still yields a useful annotation. One per-session store backs both entries, so a single list read seeds the whole transcript and the after-send control sees the same pending set the annotate action wrote.

Submitting with annotations appends a plain-text block to the current draft and sends it through the ordinary composer sink:

```text
[Annotations]
1. “selected text”: comment
```

## Model Experience

The annotations become model-visible only at submit: the `submit-annotations` action writes `draft + "\n\n[Annotations]\n…"` through `inputActions.setDraft`, then submits, so the block rides the user message as ordinary text. It does not add a Session event, a content block, or a projection of its own; replay reconstructs it as part of the submitted user message.

#### KV Cache effect

None beyond the ordinary user message: the appended block is part of the submitted text, so it shifts the history tail exactly as a longer user message would.

## Known Limitations and Deferred Work

- **Client-local state** — annotations live in a per-session in-memory store and are lost on page reload; there is no Host persistence.
- **No inline highlight** — the quoted text is recorded and re-emitted at submit but not highlighted in the source message.
- **No preset scoping** — the surface is active for every session; a preset gate would need a session-header signal rather than the prototype's string comparison.
