'use client'

import { Button } from "@/components/ui/button";
import { Link } from "lucide-react";
import {useMap} from "@/components/ui/map";

interface StationInfoDrawerProps {
    isDesktop: boolean;
}

const CENTER_SF = [-122.4194, 37.7749];
const CENTER_OAK = [-122.2711, 37.8044];
const CENTER_SJ = [-121.8863, 37.3382];

export function AboutInfo({ isDesktop }: StationInfoDrawerProps) {

    const { map, isLoaded } = useMap();

    return (
        <div className="space-y-8 text-gray-300 text-sm leading-relaxed h-min">
            <div>
                <h2 className="text-2xl font-semibold text-white mb-1">BayWheel(.ing)</h2>
                <p className="text-gray-400 text-sm">Exploring Bay Area bike-share patterns with Bay Wheel open data</p>
            </div>

            {!isDesktop && (
                <div className="bg-gray-900 rounded-lg p-4 space-y-3">
                    <p className="font-semibold text-white">Best viewed on desktop</p>
                    <p className="text-xs text-gray-400">
                        This interactive map experience works best on a larger screen. Open this link on your computer for the full experience.
                    </p>
                    <Button
                        onClick={() => {
                            if (navigator.share) {
                                navigator.share({
                                    title: 'Baywheeling',
                                    text: 'Check out this interactive Bay Area bike-share visualization',
                                    url: window.location.href,
                                }).catch(err => console.log('Error sharing:', err));
                            } else {
                                navigator.clipboard.writeText(window.location.href).then(() => {
                                    alert('Link copied to clipboard!');
                                });
                            }
                        }}
                        size="sm"
                        className="w-full gap-2"
                    >
                        <Link className="w-4 h-4" />
                        Send to yourself
                    </Button>
                </div>
            )}

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">About</h3>
                <p>
                    Baywheel.ing visualizes BayWheels trip patterns using <a className="underline decoration-dotted cursor-pointer" href="https://www.lyft.com/bikes/bay-wheels/system-data" target="_blank" rel="noopener noreferrer">anonymized historical system data published by Lyft.</a>
                </p>
            </section>

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">How It Works</h3>
                <p>
                    Click any station to view stats. Browse different months to spot seasonal patterns.
                </p>

                {isDesktop && (
                    <div className="pt-2">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Explore the cities</h4>
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
                        <strong>Route lines</strong> are computed using <a className="underline decoration-dotted cursor-pointer" href={'https://project-osrm.org'}>OSRM</a>, the only free open-source routing engine I could find.
                    </p>
                    <p>
                        It only supports <code>driving</code> and <code>walking</code> modes. I chose <code>driving</code> because walking had more issues.
                    </p>
                    <p>
                        If you have another free and simple option, feel free to open an issue.
                    </p>
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white">Built With</h3>
                <ul className="space-y-1 text-xs">
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://nextjs.org" target="_blank" rel="noopener noreferrer">Next.js</a> with <a className="underline decoration-dotted cursor-pointer" href="https://ui.shadcn.com" target="_blank" rel="noopener noreferrer">shadcn/ui</a> and <a className="underline decoration-dotted cursor-pointer" href="https://tailwindcss.com" target="_blank" rel="noopener noreferrer">Tailwind</a></li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://maplibre.org" target="_blank" rel="noopener noreferrer">MapLibre GL</a> (via <a className="underline decoration-dotted cursor-pointer" href="https://developers.maptiler.com/docs/mapcn" target="_blank" rel="noopener noreferrer">mapcn</a> and <a className="underline decoration-dotted cursor-pointer" href="https://carto.com" target="_blank" rel="noopener noreferrer">carto</a>) for mapping</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://deck.gl" target="_blank" rel="noopener noreferrer">Deck.gl</a> for route rendering</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://recharts.org" target="_blank" rel="noopener noreferrer">Recharts</a> for charts</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare</a> via <a className="underline decoration-dotted cursor-pointer" href="https://opennext.js.org" target="_blank" rel="noopener noreferrer">opennext</a> for hosting</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://workers.cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare Workers</a> for edge compute</li>
                    <li><a className="underline decoration-dotted cursor-pointer" href="https://developers.cloudflare.com/d1" target="_blank" rel="noopener noreferrer">Cloudflare D1</a> for caching routes</li>
                    <li className={'mt-4 mb-[-5]'}>This project is also open source, you can check out the code on <a href="https://github.com/quacksire/baywheeling" className="underline decoration-dotted cursor-pointer" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                </ul>
            </section>
        </div>
    );
}
