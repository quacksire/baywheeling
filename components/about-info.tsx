'use client'

import { Button } from "@/components/ui/button";
import { Link } from "lucide-react";
import {useMap} from "@/components/ui/map";
import { Progress } from "@/components/ui/progress";

export interface ImportProgress {
    label: string;
    status: string;
    phase?: 'queued' | 'importing' | 'mapping' | 'failed' | 'complete';
    startedAt?: string | null;
    importComplete?: boolean;
    importedRows: number;
    totalRows: number;
    routesMapped: number;
    routesTotal: number;
    routesPerSecond?: number | null;
    etaSeconds?: number | null;
    routesProcessed?: number;
}

interface StationInfoDrawerProps {
    isDesktop: boolean;
    importProgress: ImportProgress | null;
    loadingImportProgress: boolean;
}

const CENTER_SF = [-122.4194, 37.7749];
const CENTER_OAK = [-122.2711, 37.8044];
const CENTER_SJ = [-121.8863, 37.3382];

export function AboutInfo({ isDesktop, importProgress, loadingImportProgress }: StationInfoDrawerProps) {

    const { map } = useMap();
    const progressValue = importProgress
        ? getProgressValue(importProgress)
        : 0;
    const etaLabel = importProgress?.status === 'running'
        ? formatRemaining(importProgress.etaSeconds)
        : null;
    const speedLabel = importProgress?.status === 'running'
        ? formatSpeed(importProgress.routesPerSecond)
        : null;
    const activityLabel = importProgress ? describeImportActivity(importProgress) : null;
    return (
        <div className="space-y-8 text-gray-300 text-sm leading-relaxed h-min">
            <div>
                <h2 className="text-2xl font-semibold text-white mb-1">Baywheeling</h2>
                <p className="text-gray-400 text-sm">A closer look at how BayWheels moves through the Bay.</p>
            </div>

            {(loadingImportProgress || importProgress) && (
                <section className="border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-white">Data import</h3>
                        <div className="text-right">
                            {importProgress?.status === 'running' ? (
                                <>
                                    <div className="text-xs text-white tabular-nums">{etaLabel ?? 'estimating...'}</div>
                                    {speedLabel && <div className="text-[10px] text-gray-400">{speedLabel}</div>}
                                </>
                            ) : loadingImportProgress && !importProgress ? (
                                <span className="text-xs text-gray-400">Checking status...</span>
                            ) : null}
                        </div>
                    </div>
                    {importProgress && (
                        <>
                            <p className="text-xs text-gray-300">
                                {activityLabel}
                            </p>
                            <Progress value={progressValue} data-state={'loading'}  className="w-full" />
                            <div className="space-y-0.5 text-xs text-gray-500">
                                <p>
                                    {importProgress.importedRows.toLocaleString()} rows imported
                                    {importProgress.totalRows > 0 ? ` of ${importProgress.totalRows.toLocaleString()}` : ''}
                                </p>
                                <p>
                                    {importProgress.routesMapped.toLocaleString()} routes mapped
                                </p>
                            </div>
                        </>
                    )}
                </section>
            )}

            {!isDesktop && (
                <div className="bg-gray-900 rounded-lg p-4 space-y-3">
                    <p className="font-semibold text-white">This map opens up on a larger screen</p>
                    <p className="text-xs text-gray-400">
                        You can still browse here, but the full station and route view is easier to explore on desktop.
                    </p>
                    <Button
                        onClick={() => {
                            if (navigator.share) {
                                navigator.share({
                                    title: 'Baywheeling',
                                    text: 'Take a look at this Bay Area bike-share map',
                                    url: window.location.href,
                                }).catch(err => console.log('Error sharing:', err));
                            } else {
                                navigator.clipboard.writeText(window.location.href).then(() => {
                                    alert('Map link copied.');
                                });
                            }
                        }}
                        size="sm"
                        className="w-full gap-2"
                    >
                        <Link className="w-4 h-4" />
                        Send map link
                    </Button>
                </div>
            )}

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">About</h3>
                <p>
                    Baywheeling maps BayWheels trip patterns using <a className="underline decoration-dotted cursor-pointer" href="https://www.lyft.com/bikes/bay-wheels/system-data" target="_blank" rel="noopener noreferrer">anonymized historical system data published by Lyft.</a> Pick a station, step through the months, and see where riders tend to head next.
                </p>
            </section>

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">How It Works</h3>
                <p>
                    Click any station to open its monthly snapshot. The panel tracks ride totals, busiest hours, weekday patterns, bike mix, and the destinations that show up most often.
                </p>

                {isDesktop && (
                    <div className="pt-2">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Jump to a city cluster</h4>
                        <div className="grid grid-cols-3 gap-2">
                            <Button onClick={() => map?.flyTo({ center: CENTER_SF as [number, number], zoom: 12.5, duration: 1000 })} variant="outline" size="sm" className="cursor-pointer hover:bg-gray-900 hover:text-white transition-colors">
                                San Francisco
                            </Button>

                            <Button onClick={() => map?.flyTo({ center: CENTER_OAK as [number, number], zoom: 12.5, duration: 1000 })} variant="outline" size="sm" className="cursor-pointer hover:bg-gray-900 hover:text-white transition-colors">
                                Oakland
                            </Button>

                            <Button onClick={() => map?.flyTo({ center: CENTER_SJ as [number, number], zoom: 13, duration: 1000 })} variant="outline" size="sm" className="cursor-pointer hover:bg-gray-900 hover:text-white transition-colors">
                                San Jose
                            </Button>
                        </div>
                    </div>
                )}
            </section>

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">Limitations</h3>
                <div className="text-xs space-y-2">
                    <p>
                        <strong>Route lines</strong> are estimated with <a className="underline decoration-dotted cursor-pointer" href={'https://project-osrm.org'}>OSRM</a>. The dataset only includes start and end stations, so the line on the map is a best guess, not a recorded trip trace.
                    </p>
                    <p>
                        OSRM only offers <code>driving</code> and <code>walking</code> profiles here. I use <code>driving</code> because it produces fewer routing errors, even though it is not a perfect stand-in for bike travel.
                    </p>
                    <p>
                        If you know a better free routing option, I would love to hear about it in an issue or pull request.
                    </p>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">Built With</h3>
                <ul className="space-y-1 text-xs">
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://nextjs.org" target="_blank" rel="noopener noreferrer">Next.js</a> with <a className="underline decoration-dotted cursor-pointer" href="https://ui.shadcn.com" target="_blank" rel="noopener noreferrer">shadcn/ui</a> and <a className="underline decoration-dotted cursor-pointer" href="https://tailwindcss.com" target="_blank" rel="noopener noreferrer">Tailwind</a></li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://maplibre.org" target="_blank" rel="noopener noreferrer">MapLibre GL</a> (via <a className="underline decoration-dotted cursor-pointer" href="https://developers.maptiler.com/docs/mapcn" target="_blank" rel="noopener noreferrer">mapcn</a> and <a className="underline decoration-dotted cursor-pointer" href="https://carto.com" target="_blank" rel="noopener noreferrer">carto</a>) for mapping</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://deck.gl" target="_blank" rel="noopener noreferrer">Deck.gl</a> for route rendering</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://tripwire.sh/dither-kit" target="_blank" rel="noopener noreferrer">Dither Kit</a> for charts and visual primitives</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare</a> via <a className="underline decoration-dotted cursor-pointer" href="https://opennext.js.org" target="_blank" rel="noopener noreferrer">opennext</a> for hosting</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://workers.cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare Workers</a> for edge compute</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://developers.cloudflare.com/d1" target="_blank" rel="noopener noreferrer">Cloudflare D1</a> for caching routes</li>
                    <li className={'mt-4 mb-[-5]'}>The project is open source, and the code lives on <a href="https://github.com/quacksire/baywheeling" className="underline decoration-dotted cursor-pointer" target="_blank" rel="noopener noreferrer">GitHub</a>.</li>
                </ul>
            </section>
        </div>
    );
}

function describeImportActivity(importProgress: ImportProgress) {
    switch (importProgress.phase) {
        case 'mapping':
            return `Mapping ${importProgress.label}`;
        case 'importing':
            return `Importing ${importProgress.label}`;
        case 'queued':
            return `Queued: ${importProgress.label}`;
        case 'failed':
            return `Paused: ${importProgress.label}`;
        case 'complete':
            return `${importProgress.label} is ready.`;
        default:
            return importProgress.status === 'running'
                ? `${importProgress.label} is loading now.`
                : `${importProgress.label} is queued next.`;
    }
}

function formatSpeed(routesPerSecond: number | null | undefined) {
    if (!routesPerSecond || !Number.isFinite(routesPerSecond) || routesPerSecond <= 0) {
        return null;
    }

    return `${routesPerSecond.toFixed(routesPerSecond >= 10 ? 0 : 1)} routes/sec`;
}

function formatRemaining(seconds: number | null | undefined) {
    if (seconds == null || !Number.isFinite(seconds)) {
        return null;
    }

    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, '0')}m left`;
    }

    if (minutes > 0) {
        return `${minutes}m ${secs.toString().padStart(2, '0')}s left`;
    }

    return `${secs}s left`;
}

function getProgressValue(importProgress: ImportProgress) {
    if (importProgress.totalRows > 0) {
        const completedRows = importProgress.importComplete
            ? importProgress.routesMapped
            : importProgress.importedRows;
        return Math.min(100, (completedRows / importProgress.totalRows) * 100);
    }

    if (!importProgress.importComplete) {
        return importProgress.importedRows ? 15 : 0;
    }

    return importProgress.routesMapped ? 15 : 0;
}
