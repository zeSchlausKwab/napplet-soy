import { directSource } from '@/lib/protocol-catalog';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Code2, FileCode2, Folder, Download, ArrowLeft } from 'lucide-react';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import type { SourceView } from '../../../../packages/backend/src/source';
import { RemixButton } from './remix-button';

const highlighter = createLowlight({ javascript, typescript, css, xml, json, markdown, bash });
const languages: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  html: 'xml',
  svg: 'xml',
  xml: 'xml',
  json: 'json',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
};
// Lowlight produces HAST, but only text and span tokens are accepted into React.
// Source never becomes HTML, a live SVG, rendered Markdown or an executable preview.
type Token = {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: Token[];
};
function tokens(nodes: Token[], prefix = ''): ReactNode[] {
  return nodes.map((node, i) =>
    node.type === 'text' ? (
      node.value
    ) : (
      <span
        key={`${prefix}${i}`}
        className={
          Array.isArray(node.properties?.className)
            ? node.properties.className
                .filter((c): c is string => typeof c === 'string' && /^[\w-]+$/.test(c))
                .join(' ')
            : undefined
        }
      >
        {tokens(node.children ?? [], `${prefix}${i}.`)}
      </span>
    ),
  );
}
function SourceCode({ path, text }: { path: string; text: string }) {
  const code = useMemo(() => {
    const language = languages[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!language || new TextEncoder().encode(text).length > 64 * 1024) return text;
    try {
      return tokens(highlighter.highlight(language, text).children as Token[]);
    } catch {
      return text;
    }
  }, [path, text]);
  return (
    <pre tabIndex={0} aria-label={`Source code for ${path}`}>
      <code>{code}</code>
    </pre>
  );
}

type Tree = { dirs: Map<string, Tree>; files: string[] };
function fileTree(files: SourceView['files']) {
  const root: Tree = { dirs: new Map(), files: [] };
  for (const { path } of files) {
    const parts = path.split('/');
    let at = root;
    for (const name of parts.slice(0, -1)) {
      if (!at.dirs.has(name)) at.dirs.set(name, { dirs: new Map(), files: [] });
      at = at.dirs.get(name)!;
    }
    at.files.push(path);
  }
  return root;
}
function FileTree({ tree, source }: { tree: Tree; source: SourceView }) {
  return (
    <ul>
      {[...tree.dirs].map(([name, child]) => (
        <li key={name}>
          <details open>
            <summary>
              <Folder size={14} aria-hidden="true" />
              {name}
            </summary>
            <FileTree tree={child} source={source} />
          </details>
        </li>
      ))}
      {tree.files.map((path) => (
        <li key={path}>
          <Link
            to="/r/$snapshot/source"
            params={{ snapshot: source.revision }}
            search={{ file: path, view: source.view }}
            resetScroll={false}
            preload={false}
            aria-current={source.selected?.path === path ? 'page' : undefined}
            title={path}
          >
            <FileCode2 size={14} aria-hidden="true" />
            <span>{path.split('/').pop()}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
function bytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
async function downloadSource(source: SourceView) {
  const file = await directSource.download({
    revision: source.revision,
    file: source.selected?.path,
    view: source.view,
  });
  if (!file) throw new Error('Source file unavailable');
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)]));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SourceBrowser({ source }: { source: SourceView }) {
  const tree = useMemo(() => fileTree(source.files), [source.files]);
  const selected = source.selected;
  return (
    <section className="source-page">
      <Link className="back-link" to="/r/$snapshot" params={{ snapshot: source.revision }}>
        <ArrowLeft size={14} />
        Back to {source.title}
      </Link>
      <div className="source-heading">
        <div>
          <span className="eyebrow">SOURCE / PINNED RELEASE</span>
          <h1>
            Made of little things<span className="coral">.</span>
          </h1>
          <p>{source.title}</p>
        </div>
        <RemixButton revision={source.revision} title={source.title} />
      </div>
      <dl className="source-provenance">
        <div>
          <dt>Release</dt>
          <dd>
            <Link to="/r/$snapshot" params={{ snapshot: source.revision }} title={source.revision}>
              {source.revision.slice(0, 12)}…
            </Link>
          </dd>
        </div>
        <div>
          <dt>Author-recorded commit</dt>
          <dd title={source.commit ?? undefined}>
            {source.commit ? `${source.commit.slice(0, 12)}…` : 'Not provided'}
          </dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>
            {source.licenseFile ? (
              <Link
                to="/r/$snapshot/source"
                params={{ snapshot: source.revision }}
                search={{ file: source.licenseFile, view: 'project' }}
                preload={false}
              >
                {source.licenseFile}
              </Link>
            ) : (
              'Check the original source'
            )}
          </dd>
        </div>
        {source.sourceUrl && (
          <div>
            <dt>Author’s source link</dt>
            <dd>
              <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
                Open external source ↗
              </a>
              <small>May change independently of this release</small>
            </dd>
          </div>
        )}
        {!source.sourceUrl && source.sourceReference && (
          <div>
            <dt>Author’s source reference</dt>
            <dd className="source-reference">{source.sourceReference}</dd>
          </div>
        )}
      </dl>
      <nav className="source-tabs" aria-label="Source view">
        <Link
          to="/r/$snapshot/source"
          params={{ snapshot: source.revision }}
          search={{ view: 'project' }}
          aria-current={source.view === 'project' ? 'page' : undefined}
          preload={false}
        >
          Original project
        </Link>
        <Link
          to="/r/$snapshot/source"
          params={{ snapshot: source.revision }}
          search={{ view: 'html' }}
          aria-current={source.view === 'html' ? 'page' : undefined}
          preload={false}
        >
          Built HTML
        </Link>
        {source.archiveHash && (
          <a
            className="source-archive-link"
            href={source.archiveUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={14} />
            Download archive
          </a>
        )}
      </nav>
      {source.archiveHash && (
        <p className="source-explanation">
          Archive hash verified:{' '}
          <code title={source.archiveHash}>{source.archiveHash.slice(0, 16)}…</code>. The
          source-to-build association is the author’s claim; it has not been independently rebuilt.
        </p>
      )}
      {source.view === 'html' && (
        <p className="source-explanation">
          The hash-verified playable HTML, which may contain bundled or minified code. This view
          does not execute it.
        </p>
      )}
      {source.message ? (
        <div className="source-empty" role="status">
          <Code2 size={26} />
          <h2>Source isn’t available in this view.</h2>
          <p>{source.message}</p>
          {source.view === 'project' && (
            <Link
              to="/r/$snapshot/source"
              params={{ snapshot: source.revision }}
              search={{ view: 'html' }}
              preload={false}
            >
              Inspect the built HTML →
            </Link>
          )}
        </div>
      ) : (
        <div className="source-workspace">
          <nav className="source-files" aria-label="Project files">
            <div className="source-file-count">
              {source.files.length} {source.files.length === 1 ? 'file' : 'files'}
            </div>
            <FileTree tree={tree} source={source} />
          </nav>
          <div className="source-reader">
            {selected && (
              <>
                <div className="source-toolbar">
                  <span title={selected.path}>{selected.path}</span>
                  <div>
                    {selected.size !== null && <span>{bytes(selected.size)}</span>}
                    {selected.state !== 'missing' && (
                      <a
                        href={source.view === 'html' ? (source.artifactUrl ?? undefined) : '#'}
                        onClick={(event) => {
                          event.preventDefault();
                          void downloadSource(source).catch(() =>
                            alert('Could not download this file. Please retry.'),
                          );
                        }}
                        aria-label={`Download ${selected.path}`}
                      >
                        <Download size={14} />
                        Download file
                      </a>
                    )}
                    <Link
                      to="/r/$snapshot/source"
                      params={{ snapshot: source.revision }}
                      search={{ view: source.view, file: selected.path }}
                      preload={false}
                    >
                      Permalink
                    </Link>
                  </div>
                </div>
                {selected.state === 'text' ? (
                  <SourceCode path={selected.path} text={selected.text!} />
                ) : (
                  <div className="source-empty">
                    <FileCode2 size={26} />
                    <h2>
                      {selected.state === 'missing'
                        ? 'File not found.'
                        : selected.state === 'binary'
                          ? 'A binary file.'
                          : 'A little too big for this view.'}
                    </h2>
                    <p>
                      {selected.state === 'missing'
                        ? 'This path is not in the selected release. Choose a file from the tree.'
                        : selected.state === 'binary'
                          ? 'Download this file to inspect it with a suitable application.'
                          : 'Files over 200 KB are available as downloads to keep browsing responsive.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
