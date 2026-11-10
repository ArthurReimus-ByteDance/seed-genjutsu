# Seed Genjutsu Repository Workflow

- The canonical repository is `https://github.com/artreimus/seed-genjutsu`.
- The integration branch is `main`. Collaborator write access does not authorize
  direct pushes to `main`.
- Make changes on a dedicated feature, fix, or documentation branch and open a
  pull request in `artreimus/seed-genjutsu` with `main` as the base.
- Do not push directly to `main`, force-push, bypass branch protections, or merge
  a pull request without an explicit user request.
- Commit and push only when requested. Review the complete pull request diff and
  run applicable tests, smoke checks, lint, typechecking, and the build.
- Keep secrets, local runtime state, review media bundles, and unrelated scratch
  artifacts out of commits. Preserve unrelated user changes.
- Use `gh` for GitHub operations and return the pull request URL after creation.
