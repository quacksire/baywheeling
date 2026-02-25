#!/bin/bash

# Load all SQL seed files into D1 in order

set -e

echo "Loading all seed files into baywheels D1..."

for file in seeds/all_rides_part_*.sql; do
    if [ -f "$file" ]; then
        echo "Loading $file..."
        npx wrangler d1 execute baywheels --remote --file "$file" --yes
    fi
done

echo "Done!"
