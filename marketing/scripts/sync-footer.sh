#!/bin/bash
# Sync footer.html component to all HTML files that inline the footer
# Usage: ./scripts/sync-footer.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETING_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FOOTER_FILE="$MARKETING_DIR/components/footer.html"

# Extract footer content (skip header comments, get the actual footer HTML)
# Indent with 2 spaces to match HTML structure
FOOTER_CONTENT=$(sed -n '/^<footer/,/^<\/footer>/p' "$FOOTER_FILE" | sed 's/^/  /')

# Files that contain inline footers (with their relative paths to components)
declare -A FILE_PATHS=(
  ["$MARKETING_DIR/index.html"]="components/footer.html"
  ["$MARKETING_DIR/features.html"]="components/footer.html"
  ["$MARKETING_DIR/blog.html"]="components/footer.html"
  ["$MARKETING_DIR/blog/post-template.html"]="../components/footer.html"
  ["$MARKETING_DIR/blog/ats-optimization-playbook.html"]="../components/footer.html"
  ["$MARKETING_DIR/blog/linkedin-profile-optimization.html"]="../components/footer.html"
  ["$MARKETING_DIR/blog/7-day-interview-prep-routine.html"]="../components/footer.html"
)

for file in "${!FILE_PATHS[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Warning: $file not found, skipping"
    continue
  fi
  
  REL_PATH="${FILE_PATHS[$file]}"
  
  # Create temp file
  TEMP_FILE=$(mktemp)
  
  # Determine sync script path based on file location
  if [[ "$file" == *"/blog/"* ]]; then
    SYNC_SCRIPT_PATH="../scripts/sync-footer.sh"
  else
    SYNC_SCRIPT_PATH="scripts/sync-footer.sh"
  fi
  
  # Replace footer section (from comment to closing footer tag)
  awk -v footer="$FOOTER_CONTENT" -v rel_path="$REL_PATH" -v sync_script="$SYNC_SCRIPT_PATH" '
    /<!-- Footer \(inline for crawler visibility\) -->/ {
      print "  <!-- Footer (inline for crawler visibility) -->"
      print "  <!-- Source: " rel_path " - update there and run " sync_script " -->"
      print footer
      # Skip until closing footer tag
      while (getline > 0 && !/^  <\/footer>/) {}
      print "  </footer>"
      next
    }
    { print }
  ' "$file" > "$TEMP_FILE"
  
  mv "$TEMP_FILE" "$file"
  echo "Updated: $file"
done

echo "Footer sync complete!"
