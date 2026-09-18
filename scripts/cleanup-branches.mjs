#!/usr/bin/env node
/**
 * Deletes stale branches whose commits are fully contained in main or staging.
 * Reports any branches with unique unmerged commits.
 * 
 * See docs/adr/0008-branch-topology-and-deploy-triggers.md
 */

import { execSync } from 'child_process';

const TARGETS = ["origin/main", "origin/staging"];

function runCommand(command, ignoreErrors = false) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    if (ignoreErrors) return null;
    throw err;
  }
}

console.log("Fetching latest from remote...");
runCommand("git fetch origin --prune");

// Get all remote branches except HEAD, main, and staging
const branchesOutput = runCommand("git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin");
const branches = branchesOutput.split('\n')
  .map(b => b.trim().replace(/^'|'$/g, ''))
  .filter(b => b && !b.match(/^(HEAD|main|staging)$/));

if (branches.length === 0) {
  console.log("No remote branches to check.");
  process.exit(0);
}

console.log("\nChecking branches for containment in main or staging...");
console.log("--------------------------------------------------------");

for (const branch of branches) {
  let contained = false;
  
  for (const target of TARGETS) {
    // If exit code is 0, it's an ancestor
    try {
      execSync(`git merge-base --is-ancestor "origin/${branch}" "${target}"`, { stdio: 'ignore' });
      contained = true;
      break;
    } catch {
      // not an ancestor
    }
  }

  if (contained) {
    console.log(`✅ [MERGED] ${branch} is fully contained.`);
    console.log(`   Deleting from remote...`);
    try {
      execSync(`git push origin --delete "${branch}"`, { stdio: 'ignore' });
    } catch {
      console.log(`   (Could not delete remote branch, maybe already gone?)`);
    }

    // Delete local branch if it exists
    const localExists = runCommand(`git rev-parse --verify --quiet "${branch}"`, true);
    if (localExists) {
      console.log(`   Deleting from local...`);
      try {
        execSync(`git branch -d "${branch}"`, { stdio: 'ignore' });
      } catch {
        // failed to delete local
      }
    }
  } else {
    // Get unique commit count
    try {
      // Join targets with space for the git command
      const targetsStr = TARGETS.join(' ');
      const uniqueCount = runCommand(`git rev-list "origin/${branch}" --not ${targetsStr} --count`);
      console.log(`⚠️  [UNMERGED] ${branch} contains ${uniqueCount} unique commit(s). Keeping.`);
    } catch {
      console.log(`⚠️  [UNMERGED] ${branch} contains unique commit(s). Keeping.`);
    }
  }
}

console.log("--------------------------------------------------------");
console.log("Cleanup complete.");
