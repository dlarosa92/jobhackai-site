#!/bin/bash
# Sync footer.html component to all HTML files that inline the footer
# Usage: ./scripts/sync-footer.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETING_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FOOTER_FILE="$MARKETING_DIR/components/footer.html"

# Use Python for reliable text processing
python3 << PYTHON_SCRIPT
import os
import re
import sys

marketing_dir = "$MARKETING_DIR"
footer_file = "$FOOTER_FILE"

# Read footer content (skip header comments)
with open(footer_file, 'r') as f:
    lines = f.readlines()

# Extract footer HTML (from <footer> to </footer>)
footer_start = None
footer_end = None
for i, line in enumerate(lines):
    if line.strip().startswith('<footer'):
        footer_start = i
    if footer_start is not None and line.strip() == '</footer>':
        footer_end = i
        break

if footer_start is None or footer_end is None:
    print("Error: Could not find footer tags in footer.html", file=sys.stderr)
    sys.exit(1)

# Extract footer content and indent with 2 spaces
footer_lines = [('  ' + line.rstrip('\n')) for line in lines[footer_start:footer_end+1]]
footer_content = '\n'.join(footer_lines)

# Files to update
files = {
    'index.html': 'components/footer.html',
    'features.html': 'components/footer.html',
    'blog.html': 'components/footer.html',
    'blog/post-template.html': '../components/footer.html',
    'blog/ats-optimization-playbook.html': '../components/footer.html',
    'blog/linkedin-profile-optimization.html': '../components/footer.html',
    'blog/7-day-interview-prep-routine.html': '../components/footer.html',
}

for filename, rel_path in files.items():
    filepath = os.path.join(marketing_dir, filename)
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found, skipping")
        continue
    
    # Determine sync script path
    if 'blog/' in filename:
        sync_script = '../scripts/sync-footer.sh'
    else:
        sync_script = 'scripts/sync-footer.sh'
    
    # Read file
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Replace footer section
    pattern = r'  <!-- Footer \(inline for crawler visibility\) -->.*?  </footer>'
    replacement = f'''  <!-- Footer (inline for crawler visibility) -->
  <!-- Source: {rel_path} - update there and run {sync_script} -->
{footer_content}'''
    
    new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    
    # Write back
    with open(filepath, 'w') as f:
        f.write(new_content)
    
    print(f"Updated: {filepath}")

print("Footer sync complete!")
PYTHON_SCRIPT
