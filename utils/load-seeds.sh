#!/bin/bash

# Convert CSVs and load seeds by year-month

set -e


# step 1: convert CSVs to monthly SQL files
echo "Converting CSVs to monthly SQL..."
python3 csv_to_monthly_sql.py

# step 2: create month tables in D1
echo "Creating month tables in D1..."
npx wrangler d1 execute baywheels --remote --file "seeds_by_month_csv/00_create_tables.sql" --yes

echo "Loading month-specific seed files into baywheels D1..."

# step 3: load month-specific seed files into baywheels D1
for file in seeds_by_month_csv/rides_*.sql; do
    if [ -f "$file" ]; then
        echo "Loading $file..."
        npx wrangler d1 execute baywheels --remote --file "$file" --yes
    fi
done
# step 4: done!
echo "Done!"
