'use client'

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Grid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/dither-kit";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Progress } from "./ui/progress";
import {ButtonGroup} from "@/components/ui/button-group";
import {Button} from "@/components/ui/button";

interface StationStats {
  total_rides: number;
  member_count: number;
  casual_count: number;
  false_starts: number;
  rideableTypes: Array<{ rideable_type: string; count: number }>;
  dayOfWeek: Array<{ day_num: string; count: number }>;
  destinations: Array<{ end_station_name: string; count: number }>;
  busiestHours: Array<{ hour: string; count: number }>;
}

interface StationInfoContentProps {
  stationName: string;
  ridesCount: number;
  selectedMonth: string;
  selectedYear: string;
  selectedMonthNum: string;
  stats: StationStats | null;
  loadingRides: boolean;
  routesLoading: number;
  routesTotal: number;
  selectedMonthImportStatus?: string | null;
  isCurrentMonth: boolean;
  availableMonths: string[];
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onMonthChange: (yearMonth: string) => void;
  onRefreshMonths: () => void;
}

const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
/*
These stations don't have physical docks but are included in the dataset as virtual stations representing popular ride start/end points.
But they don't have a ride data associated with them, so we should exclude them from the station stats view to avoid confusion.
Still show them in the map and allow users to click on them to see the "no rides" message, but exclude from month navigation and stats since they will always show zero rides and skew the false start percentage.

 */
const virtualStations = [
    "bowling green",
    "stowe lake",
    "lloyd lake",
    "hellman hollow",
    "30th ave",
    "south lake",
    "chain o’ lakes",
    "vincente st at great hwy",
    "sloat blvd at the great highway to 46th ave",
    "taraval st at 41st ",
    "taraval st at 40th",
    "taraval st at 26th ",
    "taraval st at 22nd ",
    "forest hill ",
    "laguna honda hospital",
    "ocean ave west: to fairfield way",
    "ocean avenue east: to plymouth ave",
    "mission at whipple",
]

export function   StationInfoContent({
  stationName,
  ridesCount,
  selectedMonth,
  selectedYear,
  selectedMonthNum,
  stats,
  loadingRides,
  routesLoading,
  routesTotal,
  selectedMonthImportStatus,
  isCurrentMonth,
  availableMonths,
  onPreviousMonth,
  onNextMonth,
  onMonthChange,
  onRefreshMonths,
}: StationInfoContentProps) {

    const isVirtualStation = virtualStations.includes(stationName.toLowerCase());
    console.log(stationName.toLowerCase());
    console.log(virtualStations);
    const statsRideCount = stats?.total_rides ?? 0;
    const effectiveRidesCount = Math.max(ridesCount, statsRideCount);
    const availableYears = Array.from(
        new Set(availableMonths.map((yearMonth) => yearMonth.split('-')[0]))
    ).sort((a, b) => b.localeCompare(a));
    const availableMonthsForYear = availableMonths
        .filter((yearMonth) => yearMonth.startsWith(`${selectedYear}-`))
        .map((yearMonth) => yearMonth.split('-')[1])
        .sort((a, b) => parseInt(b) - parseInt(a));
    const isMonthStillProcessing = selectedMonthImportStatus === 'queued' || selectedMonthImportStatus === 'running';
    const didMonthFail = selectedMonthImportStatus === 'failed';
    const hasAnyRideSignal = effectiveRidesCount > 0;
    const hasStatsBackfill = !loadingRides && ridesCount === 0 && statsRideCount > 0;
    const dayOfWeekChartData = useMemo(
        () => stats?.dayOfWeek.map((d) => ({
            ...d,
            day_name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
                parseInt(d.day_num) || 0
            ],
        })) ?? [],
        [stats?.dayOfWeek]
    );
    const busiestHoursChartData = useMemo(
        () => stats?.busiestHours.map((h) => ({
            ...h,
            hour_label: `${h.hour}:00`,
        })) ?? [],
        [stats?.busiestHours]
    );
    const rideableTypeConfig = useMemo(() => {
        const colors = ["blue", "purple", "pink", "orange", "green", "red", "grey"] as const;
        return Object.fromEntries(
            (stats?.rideableTypes ?? []).map((rideableType, index) => [
                rideableType.rideable_type,
                {
                    label: rideableType.rideable_type,
                    color: colors[index % colors.length],
                },
            ])
        );
    }, [stats?.rideableTypes]);

    const handleYearChange = (year: string) => {
        onRefreshMonths();
        const currentMonthForYear = selectedMonthNum
            ? `${year}-${selectedMonthNum}`
            : '';
        const targetMonth = parseInt(selectedMonthNum || '1', 10);
        const fallbackMonth = availableMonths
            .filter((yearMonth) => yearMonth.startsWith(`${year}-`))
            .sort((a, b) => {
                const aMonth = parseInt(a.split('-')[1], 10);
                const bMonth = parseInt(b.split('-')[1], 10);
                const distance = Math.abs(aMonth - targetMonth) - Math.abs(bMonth - targetMonth);
                return distance || aMonth - bMonth;
            })[0];

        if (availableMonths.includes(currentMonthForYear)) {
            onMonthChange(currentMonthForYear);
            return;
        }

        if (fallbackMonth) {
            onMonthChange(fallbackMonth);
        }
    };

    const handleMonthSelectChange = (month: string) => {
        onRefreshMonths();
        if (selectedYear && month) {
            onMonthChange(`${selectedYear}-${month}`);
        }
    };


  return (
    <div>
      <h3 className="font-bold text-base mb-1">{stationName}</h3>
      <p className="text-xs text-muted-foreground mb-4">{effectiveRidesCount} recorded rides</p>

        {isVirtualStation && (
            <Item variant={'outline'} size="sm" className="mb-4">
                <ItemMedia>
                    {/* TODO: Add an icon for no data */}
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>
                        This is a virtual stop, not a physical dock.
                    </ItemTitle>
                    <ItemDescription>
                        Some entries in the dataset mark common pickup or dropoff areas rather than docked stations. They stay on the map for context, but they will not show ride totals or monthly stats.
                    </ItemDescription>
                </ItemContent>
            </Item>
        )}

      {/* Status/Loading Section */}
      {!isVirtualStation && !selectedMonth && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon to pick a time */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Pick a month to start exploring</ItemTitle>
              <ItemDescription>Choose a year and month below to load this dock&apos;s snapshot.</ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && loadingRides && (
          <Item variant="outline" size="sm" className="mb-4">
              <ItemMedia>
                <Spinner className="size-5" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Pulling ride counts for this dock</ItemTitle>
                <ItemDescription>Loading the month&apos;s trips and station stats.</ItemDescription>
              </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && routesLoading < routesTotal && routesTotal > 0 && (
          <Item variant="outline" size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Tracing the routes riders took next</ItemTitle>
              <ItemDescription>{routesLoading} of {routesTotal} route paths ready.</ItemDescription>
                <Progress value={routesLoading} max={routesTotal} className="w-full" />
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && !hasAnyRideSignal && isMonthStillProcessing && (
          <Item variant={'outline'} size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Still being processed</ItemTitle>
              <ItemDescription>
                  {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear} is still being imported and routed, so ride details for this dock are not ready yet.
              </ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && !hasAnyRideSignal && didMonthFail && (
          <Item variant={'outline'} size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an error icon */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Import paused for this month</ItemTitle>
              <ItemDescription>
                  {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear} has not finished processing yet, so ride details for this dock are temporarily unavailable.
              </ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && hasStatsBackfill && (
          <Item variant={'outline'} size="sm" className="mb-4">
            <ItemMedia>
              <Spinner className="size-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Ride details are still syncing</ItemTitle>
              <ItemDescription>
                  We found ride totals for {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear}, but the trip list for this dock has not caught up yet.
              </ItemDescription>
            </ItemContent>
          </Item>
      )}

      {!isVirtualStation && selectedMonth && !loadingRides && !hasAnyRideSignal && !hasStatsBackfill && !isMonthStillProcessing && !didMonthFail && (
          <Item variant={'default'} size="sm" className="mb-4">
            <ItemMedia>
              {/* TODO: Add an icon for no data */}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Quiet month at this dock</ItemTitle>
              <ItemDescription>No rides were recorded here in {monthNames[parseInt(selectedMonthNum) - 1] } {selectedYear}.</ItemDescription>
            </ItemContent>
          </Item>
      )}

      {/* Stats section */}
      {!isVirtualStation && selectedMonth && !loadingRides && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Total Rides</p>
              <p className="font-bold text-lg">{stats.total_rides}</p>
            </div>
            <div className="p-2 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">False Starts</p>
              <p className="font-bold text-lg">
                {((stats.false_starts / stats.total_rides) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">{stats.false_starts} rides</p>
            </div>
          </div>

          {/* Rideable Type Chart */}
          {stats.rideableTypes && stats.rideableTypes.length > 0 && (
              <>
                <Separator />

                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">Bike Type Usage</p>
                  <PieChart
                    data={stats.rideableTypes}
                    config={rideableTypeConfig}
                    dataKey="count"
                    nameKey="rideable_type"
                    className="h-[120px]"
                    bloom="low"
                  >
                    <Pie variant="gradient" />
                    <Legend isClickable align="right" />
                  </PieChart>
                </div>
              </>

          )}

          {/* Day of Week Chart */}
          {stats.dayOfWeek && stats.dayOfWeek.length > 0 && (
              <>

                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Weekday pattern
                  </p>
                  <LineChart
                    data={dayOfWeekChartData}
                    config={{ count: { label: "Rides", color: "purple" } }}
                    className="h-[120px]"
                    bloom="low"
                  >
                    <Grid />
                    <XAxis dataKey="day_name" />
                    <YAxis />
                    <Line dataKey="count" variant="dotted" />
                  </LineChart>
                </div>
              </>

          )}

          {/* Busiest Hours */}
          {stats.busiestHours && stats.busiestHours.length > 0 && (
              <>
              <Separator />
                <div className="mx-[-1rem]">
                  <p className="text-xs text-muted-foreground mb-2 px-4">
                    Busiest hours
                  </p>
                  <LineChart
                    data={busiestHoursChartData}
                    config={{ count: { label: "Rides", color: "orange" } }}
                    className="h-[120px]"
                    bloom="aura"
                  >
                    <Grid />
                    <XAxis dataKey="hour_label" maxTicks={8} />
                    <YAxis />
                    <Tooltip labelKey="hour_label" />
                    <Line dataKey="count" variant="gradient" />
                  </LineChart>
                </div>
              </>


          )}

          <Separator />

          {/* Top Destinations */}
          {stats.destinations && stats.destinations.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Where riders went next</p>
              <div className="space-y-2">
                {stats.destinations.map((dest, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="truncate flex-1">{dest.end_station_name}</span>
                    <Badge variant="outline" className="text-xs ml-2">
                      {dest.count}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Month Navigation */}
      <div className="mt-4 space-y-3">

          <div className={'w-full text-center text-xs text-muted-foreground'}>
              Time window
          </div>

          <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Year</span>
                  <select
                      value={selectedYear}
                      onFocus={onRefreshMonths}
                      onMouseDown={onRefreshMonths}
                      onChange={(event) => handleYearChange(event.target.value)}
                      disabled={loadingRides || availableYears.length === 0}
                      aria-label="Select ride year"
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 h-9 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                      {availableYears.map((year) => (
                          <option key={year} value={year}>
                              {year}
                          </option>
                      ))}
                  </select>
              </label>

              <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Month</span>
                  <select
                      value={selectedMonthNum}
                      onFocus={onRefreshMonths}
                      onMouseDown={onRefreshMonths}
                      onChange={(event) => handleMonthSelectChange(event.target.value)}
                      disabled={loadingRides || availableMonthsForYear.length === 0}
                      aria-label="Select ride month"
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 h-9 w-full rounded-none border bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                      {availableMonthsForYear.map((month) => (
                          <option key={month} value={month}>
                              {monthNames[parseInt(month) - 1]}
                          </option>
                      ))}
                  </select>
              </label>
          </div>

          <ButtonGroup className="flex items-center justify-between gap-3 w-full">
              <Button variant={'ghost'} className={'flex items-center'}
                      onClick={onPreviousMonth}
                      disabled={loadingRides}>
                  <ChevronLeft className="h-4 w-4" />
                  <span>Previous</span>

              </Button>

              {selectedMonth && (
                  <Button className="text-center text-sm font-medium text-white">
                      {monthNames[parseInt(selectedMonthNum) - 1]} {selectedYear}
                  </Button>
              )}

              <Button variant={'ghost'} className={'flex items-center'}
                      onClick={onNextMonth}
                      disabled={loadingRides || isCurrentMonth}>
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" />

              </Button>


          </ButtonGroup>
      </div>
    </div>
  );
}
