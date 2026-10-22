# Issue tracker: GitHub

Issues and specs live in GitHub Issues at `hoon0422/paseo-csv-viewer`:
https://github.com/hoon0422/paseo-csv-viewer/issues

Use the `gh` CLI for tracker operations. Run every `gh` command with escalated permissions so it can access keyring-backed authentication.

## Conventions

- Pass `--repo hoon0422/paseo-csv-viewer` when the local checkout has no remote or the target is ambiguous.
- Create issues with `gh issue create --title "..." --body-file <path>`.
- Write multiline issue bodies and comments to a file, then use `--body-file` to preserve their exact content.
- Read issues with `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list --state open --json number,title,body,labels,comments` and the appropriate label filters.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`. Use the mapping in `triage-labels.md`.
- Comment with `gh issue comment <number> --body-file <path>`.
- Close completed issues with `gh issue close <number>`.

## Skill operations

- Publishing a spec or ticket means creating a GitHub issue.
- Fetching a ticket means reading the corresponding GitHub issue and its comments.
- Treat GitHub as the authoritative tracker; local drafts are working copies.
- For sub-issues, use native parent/child links when supported. Otherwise place `Part of #<parent>` at the top of the child and link it from the parent.
- For blockers, use native issue dependencies when supported. Otherwise record `Blocked by: #<number>` in the issue body.

## Pull requests as a triage surface

**PRs as a request surface: no.**
