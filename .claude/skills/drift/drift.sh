#!/usr/bin/env bash
# Drift view: main vs staging + top N branches/worktrees (ahead-of-staging first).
# usage: drift.sh [N=3] [--no-fetch]
N=${1:-3}; [ "$2" = "--no-fetch" ] || git fetch --all --prune -q 2>/dev/null
BASE=origin/staging
bar(){ # n char -> bar capped at 30
  local n=$1 c=$2 m=$(( $1>30 ? 30 : $1 )) s=""; for ((i=0;i<m;i++)); do s+=$c; done; [ "$n" -gt 30 ] && s+="+"; printf '%s' "$s"; }
row(){ local b a # label ref
  read -r b a < <(git rev-list --left-right --count "$BASE...$2" 2>/dev/null) || return
  printf '%-34s behind %-4s ahead %-3s %s\n' "${1:0:34}" "$b" "$a" "$(git log -1 --format=%cs "$2")"
  printf '    %s|%s\n' "$(bar "$b" '<')" "$(bar "$a" '>')"; }

echo "== prod vs staging"
read -r mo so < <(git rev-list --left-right --count origin/main...$BASE)
echo "main-only commits: $mo   staging-only commits: $so"
[ "$mo" -gt 0 ] && git log --format='    prod-only %h %cs %s' origin/main --not $BASE | cut -c1-110
read -r lb la < <(git rev-list --left-right --count origin/main...main)
[ "$lb" != 0 -o "$la" != 0 ] && echo "local main vs origin/main: behind $lb, ahead $la"
echo; echo "== refs vs $BASE  (< behind  > ahead)"
row main origin/main
row staging staging
read -r lsb lsa < <(git rev-list --left-right --count origin/staging...staging)
[ "$lsb" != 0 -o "$lsa" != 0 ] && echo "    local staging vs origin: ahead $lsa, behind $lsb"
echo "    dirty: $(git status --porcelain | wc -l) files in $(git rev-parse --show-toplevel)"

# candidates: local branches + worktree branches, not main/staging, not merged (ahead>0) first
declare -A WT
cur=""; while IFS= read -r l; do
  case "$l" in worktree\ *) cur=${l#worktree };; branch\ refs/heads/*) WT[${l#branch refs/heads/}]=$cur;; esac
done < <(git worktree list --porcelain)
{ for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
    [ "$b" = main -o "$b" = staging ] && continue
    a=$(git rev-list --count "$BASE..$b"); d=$(git log -1 --format=%ct "$b")
    w=0; [ -n "${WT[$b]}" ] && w=1
    printf '%s\t%s\t%s\t%s\n' "$([ "$a" -gt 0 ] && echo 1 || echo 0)" "$w" "$d" "$b"
  done; } | sort -t$'\t' -k1,1nr -k2,2nr -k3,3nr | head -n "$N" | while IFS=$'\t' read -r _ w _ b; do
  row "$b" "$b"
  [ -n "${WT[$b]}" ] && echo "    worktree: ${WT[$b]} (dirty: $(git -C "${WT[$b]}" status --porcelain | wc -l))"
  git log --format='    + %h %s' "$BASE..$b" | head -3 | cut -c1-100
done
echo; echo "other worktrees:"; git worktree list | sed 's/^/  /'
