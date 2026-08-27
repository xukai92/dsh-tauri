/** `annotations` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.annotate': '标注',
  'editor.quoted.placeholder': '选中的文本',
  'editor.comment.placeholder': '注释',
  'editor.add': '添加',
  'editor.cancel': '取消',
  'submit.label': '带标注提交',
} satisfies Record<string, string>

/** The annotations namespace key union. */
export type AnnotationsKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The text-annotation controls' copy. */
    annotations: AnnotationsKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.annotate': 'Annotate',
  'editor.quoted.placeholder': 'Quoted text',
  'editor.comment.placeholder': 'Comment',
  'editor.add': 'Add',
  'editor.cancel': 'Cancel',
  'submit.label': 'Submit w/ Annotations',
} satisfies Record<AnnotationsKey, string>
