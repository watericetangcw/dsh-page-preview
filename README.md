# dsh-page-preview

DeepSeek Harness web bundle: page previews in the Web GUI.

- **Inline preview**: a code fence marked `html page-preview` in the model's
  answer is turned into an interactive preview pane below the message (the
  fence itself stays a normal code block).
- **Floating preview**: `preview_register` / `preview_replace` /
  `preview_refresh` / `preview_unregister` tools open a movable, resizable
  bottom-right floating window (content is scaled to a virtual desktop width,
  so small windows keep desktop layout proportions) for a local HTML file, a
  directory containing `index.html`, or an http(s) URL. Closing the window
  morphs it into a top-right capsule with a breathing light; clicking the
  capsule reopens it. The registration is session-scoped.

## Install (local profile, user patch layer)

1. Keep this directory in place (the profile links to it).
2. Run `scripts/relink.ps1` to (re)create the two node_modules junctions
   (one for the `@deepseek-ai/*` host imports, one making the package
   resolvable from the profile).
3. Add the insert row to `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-page-preview
         name: 'dsh-page-preview'
   ```

   The running `dsh web` hot-reloads this layer (host tools and file routes
   appear immediately); a **DSH restart is still required** to reload the
   plugin's own module code (Node's ESM cache), then refresh the browser page
   once so the client half mounts.

4. Alternative (restart required, canonical bundle form): instead of the
   profile patch, add `dsh-page-preview` to `dsh.profile.bundles` in
   `%USERPROFILE%\.dsh\profiles\web\package.json` (the package declares
   `dsh.bundle.patch`). Use **exactly one** of the two layers — inserting the
   row from both would duplicate it.

## Notes

- Local files are served by the host over `/dsh-page-preview/fs/<token>/...`
  with traversal protection; inline previews get
  `/dsh-page-preview/snippet/<id>` URLs.
- The client talks to the host through the standard `connection` service RPC
  channel `/dsh-page-preview` (endpoints `state`, `refresh`, `snippet-save`).
