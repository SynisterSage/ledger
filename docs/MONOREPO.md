• Yes. Use a pathspec exclude.

  From repo root, stage everything except apps/mobile with:

  git add -A -- . ':(exclude)apps/mobile'

  That will:

  - stage desktop app changes
  - ignore anything under apps/mobile

  If you want to be even more explicit for your workflow:

  - desktop-only push:

  git add -A -- . ':(exclude)apps/mobile'
  git commit -m "Desktop changes"
  git push

  - mobile-only push:

  git add -A apps/mobile
  git commit -m "Mobile changes"
  git push

