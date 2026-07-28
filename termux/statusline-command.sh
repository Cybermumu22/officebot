#!/bin/sh
# Claude Code status line script

input=$(cat)

# Current working directory (shortened)
cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // empty')

# Model display name
model=$(echo "$input" | jq -r '.model.display_name // empty')

# Context window usage
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
remaining_pct=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# Git repo and branch
repo=$(echo "$input" | jq -r '.workspace.repo | if . then .owner + "/" + .name else empty end')
branch=$(echo "$input" | jq -r '.worktree.branch // .workspace.git_worktree // empty')

# Date and time
datetime=$(date "+%Y-%m-%d %H:%M")

# --- Build output sections ---

# Section 1: Directory
dir_section=""
if [ -n "$cwd" ]; then
    dir_section="$(printf '\033[1;34m\360\237\223\202 %s\033[0m' "$cwd")"
fi

# Section 2: Git repo + branch
git_section=""
if [ -n "$repo" ] && [ -n "$branch" ]; then
    git_section="$(printf '\033[1;35m git %s [%s]\033[0m' "$repo" "$branch")"
elif [ -n "$repo" ]; then
    git_section="$(printf '\033[1;35m git %s\033[0m' "$repo")"
elif [ -n "$branch" ]; then
    git_section="$(printf '\033[1;35m git [%s]\033[0m' "$branch")"
fi

# Section 3: Model
model_section=""
if [ -n "$model" ]; then
    model_section="$(printf '\033[1;36m model:%s\033[0m' "$model")"
fi

# Section 4: Context usage
ctx_section=""
if [ -n "$used_pct" ]; then
    used_int=$(printf '%.0f' "$used_pct")
    remaining_int=$(printf '%.0f' "$remaining_pct")
    if [ "$used_int" -ge 80 ]; then
        color='\033[1;31m'
    elif [ "$used_int" -ge 50 ]; then
        color='\033[1;33m'
    else
        color='\033[1;32m'
    fi
    ctx_section="$(printf "${color} ctx:%s%% used (%s%% left)\033[0m" "$used_int" "$remaining_int")"
fi

# Section 5: Date/time
time_section="$(printf '\033[0;37m %s\033[0m' "$datetime")"

# --- Assemble the line ---
line=""

append() {
    if [ -n "$1" ]; then
        if [ -n "$line" ]; then
            line="${line}$(printf '\033[0;90m  |  \033[0m')${1}"
        else
            line="$1"
        fi
    fi
}

append "$dir_section"
append "$git_section"
append "$model_section"
append "$ctx_section"
append "$time_section"

printf '%s\n' "$line"
