import type { HostPrompt } from './host';

/** Host-owned native picker. The frame only receives copied bytes and virtual paths. */
export function FilePicker({ prompt }: { prompt: HostPrompt }) {
  if (!prompt.picker) return null;
  return (
    <label>
      Choose {prompt.picker.directory ? 'folder' : 'files'}
      <input
        type="file"
        aria-label="Choose files for napplet"
        accept={prompt.picker.accept}
        multiple={prompt.picker.multiple}
        ref={(node) => {
          if (node) {
            if (prompt.picker?.directory) node.setAttribute('webkitdirectory', '');
            else node.removeAttribute('webkitdirectory');
          }
        }}
        onChange={(event) => prompt.selectFiles?.(Array.from(event.currentTarget.files ?? []))}
      />
    </label>
  );
}
