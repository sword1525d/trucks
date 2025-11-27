
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { format, formatDistanceStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';
import { Loader2, ArrowLeft, Milestone, Route, Timer, EyeOff, CheckCircle, PlayCircle, Clock, X, Hourglass, Car, Package, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Run as BaseRun, LocationPoint, AggregatedRun, FirestoreUser } from '../tracking/page';
import { useToast } from '@/hooks/use-toast';

// Dynamic import for the map component
const RealTimeMap = dynamic(() => import('../../RealTimeMap'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 flex justify-center items-center bg-background/50"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
});

const SEGMENT_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#ec4899', 
    '#6366f1', '#f59e0b', '#14b8a6', '#d946ef'
];

type StopStatus = BaseRun['status'];

const formatTimeDiff = (start: Date, end: Date) => {
    if (!start || !end) return 'N/A';
    return formatDistanceStrict(end, start, { locale: ptBR, unit: 'minute' });
};

const processRunSegments = (run: AggregatedRun) => {
    if (!run.locationHistory || run.locationHistory.length === 0) return [];
    
    const sortedLocations = [...run.locationHistory].sort((a,b) => a.timestamp.seconds - b.timestamp.seconds);
    const sortedStops = [...run.stops].filter(s => s.status === 'COMPLETED' || s.status === 'IN_PROGRESS').sort((a, b) => (a.arrivalTime?.seconds || Infinity) - (b.arrivalTime?.seconds || Infinity));

    const segments: any[] = [];
    let lastDepartureTime = run.startTime;
    let lastMileage = run.startMileage;

    for(let i = 0; i < sortedStops.length; i++) {
        const stop = sortedStops[i];
        if (!stop.arrivalTime) continue;

        const stopArrivalTime = new Date(stop.arrivalTime.seconds * 1000);
        const stopDepartureTime = stop.departureTime ? new Date(stop.departureTime.seconds * 1000) : null;
        
        const segmentDistance = (stop.mileageAtStop && lastMileage) ? stop.mileageAtStop - lastMileage : null;

        const segmentPath = sortedLocations
            .filter(loc => {
                const locTime = loc.timestamp.seconds;
                return locTime >= lastDepartureTime.seconds && locTime <= stop.arrivalTime!.seconds;
            })
            .map(loc => [loc.longitude, loc.latitude] as [number, number]);
        
        if (i > 0) {
            const prevStop = sortedStops[i-1];
            if (prevStop.departureTime) {
                 const prevDepartureTimeInSeconds = prevStop.departureTime.seconds;
                 const lastPointOfPrevSegment = sortedLocations.slice().reverse().find(l => l.timestamp.seconds <= prevDepartureTimeInSeconds);
                 if(lastPointOfPrevSegment) {
                     segmentPath.unshift([lastPointOfPrevSegment.longitude, lastPointOfPrevSegment.latitude]);
                 }
            }
        } else {
             const firstPoint = sortedLocations.find(l => l.timestamp.seconds >= run.startTime.seconds);
             if (firstPoint) {
                segmentPath.unshift([firstPoint.longitude, firstPoint.latitude]);
             }
        }
        
        segments.push({
            id: `segment-${i}`,
            label: stop.name,
            path: segmentPath,
            color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            travelTime: formatTimeDiff(new Date(lastDepartureTime.seconds * 1000), stopArrivalTime),
            stopTime: stopDepartureTime ? formatTimeDiff(stopArrivalTime, stopDepartureTime) : 'Em andamento',
            distance: segmentDistance !== null ? `${segmentDistance.toFixed(1)} km` : undefined,
            ...stop
        });
        
        if (stop.departureTime) {
            lastDepartureTime = stop.departureTime;
        }
        if (stop.mileageAtStop) {
            lastMileage = stop.mileageAtStop;
        }
    }

    if (run.status === 'IN_PROGRESS' && sortedLocations.length > 0) {
        const lastStop = sortedStops[sortedStops.length - 1];
        if (lastStop && lastStop.departureTime) {
            const lastDepartureTime = lastStop.departureTime;
            const finalSegmentPath = sortedLocations
                .filter(loc => loc.timestamp.seconds >= lastDepartureTime.seconds)
                .map(loc => [loc.longitude, loc.latitude] as [number, number]);

            if (finalSegmentPath.length > 0) {
                 segments.push({
                    id: `segment-current`,
                    label: `Posição Atual`,
                    path: finalSegmentPath,
                    color: '#71717a',
                    travelTime: formatTimeDiff(new Date(lastDepartureTime.seconds * 1000), new Date()),
                    stopTime: '',
                 });
            }
        }
    }
    return segments;
}


export default function MapViewPage() {
    const router = useRouter();
    const params = useParams();
    const { firestore } = useFirebase();
    const { toast } = useToast();

    const [runData, setRunData] = useState<AggregatedRun | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
    const [isClient, setIsClient] = useState(false);

    const runKey = useMemo(() => {
      const key = params.runKey;
      return typeof key === 'string' ? decodeURIComponent(key) : null;
    }, [params.runKey]);

    const fetchRunData = useCallback(async () => {
        if (!firestore || !runKey) return;
        setIsLoading(true);

        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        if (!companyId || !sectorId) {
            toast({ variant: "destructive", title: "Erro de Sessão", description: "Faça o login novamente." });
            router.back();
            return;
        }

        try {
            const usersCol = collection(firestore, `companies/${companyId}/sectors/${sectorId}/users`);
            const usersSnapshot = await getDocs(usersCol);
            const usersMap = new Map<string, FirestoreUser>();
            usersSnapshot.forEach(doc => {
                usersMap.set(doc.id, { id: doc.id, ...doc.data() } as FirestoreUser);
            });

            const runsCol = collection(firestore, `companies/${companyId}/sectors/${sectorId}/runs`);
            const runsSnapshot = await getDocs(runsCol);
            const allRuns = runsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BaseRun));
            
            const groupedRuns = new Map<string, BaseRun[]>();
            allRuns.forEach(run => {
                const driver = usersMap.get(run.driverId);
                const runDate = format(run.startTime.toDate(), 'yyyy-MM-dd');
                const key = `${run.vehicleId}-${driver?.shift || 'sem-turno'}-${runDate}`;
                
                if (!groupedRuns.has(key)) {
                    groupedRuns.set(key, []);
                }
                groupedRuns.get(key)!.push(run);
            });
            
            const targetRuns = groupedRuns.get(runKey);

            if (!targetRuns) {
                throw new Error("Rota não encontrada.");
            }

            targetRuns.sort((a, b) => a.startTime.seconds - b.startTime.seconds);
            const firstRun = targetRuns[0];
            const lastRun = targetRuns[targetRuns.length - 1];
            const driver = usersMap.get(firstRun.driverId);

            const allStops = targetRuns.flatMap(r => r.stops).sort((a,b) => (a.arrivalTime?.seconds || 0) - (b.arrivalTime?.seconds || 0));
            const allLocations = targetRuns.flatMap(r => r.locationHistory || []).sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);
            
            const startMileage = firstRun.startMileage;
            const endMileage = lastRun.endMileage ?? allStops.filter(s => s.mileageAtStop).slice(-1)[0]?.mileageAtStop ?? null;
            const totalDistance = (endMileage && startMileage) ? endMileage - startMileage : 0;
            const status = targetRuns.some(r => r.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : 'COMPLETED';

            const aggregated: AggregatedRun = {
                key: runKey,
                driverId: firstRun.driverId,
                driverName: firstRun.driverName,
                vehicleId: firstRun.vehicleId,
                shift: driver?.shift || 'N/A',
                date: format(firstRun.startTime.toDate(), 'dd/MM/yyyy'),
                startTime: firstRun.startTime,
                endTime: lastRun.endTime,
                totalDistance,
                stops: allStops,
                locationHistory: allLocations,
                originalRuns: targetRuns,
                startMileage: startMileage,
                status
            };

            setRunData(aggregated);

        } catch (error: any) {
            console.error("Error fetching full screen map data:", error);
            toast({ variant: "destructive", title: "Erro ao Carregar Mapa", description: error.message || "Não foi possível buscar os dados da rota." });
            router.back();
        } finally {
            setIsLoading(false);
        }
    }, [firestore, runKey, router, toast]);

    useEffect(() => {
        setIsClient(true);
        fetchRunData();
    }, [fetchRunData]);

    const segments = useMemo(() => {
        if (!runData) return [];
        return processRunSegments(runData);
    }, [runData]);

    const displayedSegments = useMemo(() => {
        if (!highlightedSegmentId) return segments.map(s => ({ ...s, opacity: 0.9 }));
        
        return segments.map(s => ({
            ...s,
            opacity: s.id === highlightedSegmentId ? 1.0 : 0.3,
        }));
    }, [segments, highlightedSegmentId]);
    
    const getStatusInfo = (status: StopStatus) => {
        switch (status) {
            case 'COMPLETED': return { icon: CheckCircle, color: 'text-green-500' };
            case 'IN_PROGRESS': return { icon: PlayCircle, color: 'text-blue-500' };
            default: return { icon: Clock, color: 'text-gray-400' };
        }
    };


    if (isLoading || !runData) {
        return (
            <div className="flex justify-center items-center h-screen bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }
    
    return (
        <div className="h-screen w-screen relative">
            {isClient && (
                <RealTimeMap
                    segments={displayedSegments}
                    fullLocationHistory={runData.locationHistory?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || []}
                    vehicleId={runData.vehicleId}
                />
            )}
            
            <div className="absolute top-4 left-4 z-10">
                <Button size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
            </div>

            <div className="absolute top-4 right-4 z-10 w-full max-w-xs">
                <Card className="bg-background/80 backdrop-blur-sm">
                    <CardContent className="p-2">
                        <div className="flex justify-between items-center p-2">
                            <h3 className="font-semibold">{runData.driverName} ({runData.vehicleId})</h3>
                             {highlightedSegmentId && (
                                <Button variant="ghost" size="sm" onClick={() => setHighlightedSegmentId(null)}>
                                    <EyeOff className="mr-2 h-4 w-4"/> Limpar
                                </Button>
                             )}
                        </div>
                        <ScrollArea className="h-[calc(100vh-12rem)]">
                            <div className="p-2 space-y-2">
                                {segments.map((segment) => {
                                    const { icon: Icon, color } = getStatusInfo(segment.status);
                                    return (
                                        <div 
                                            key={segment.id} 
                                            onClick={() => setHighlightedSegmentId(segment.id)}
                                            className={cn(
                                                "p-3 rounded-md cursor-pointer transition-all border",
                                                highlightedSegmentId === segment.id 
                                                    ? 'bg-muted ring-2 ring-primary' 
                                                    : 'bg-background/50 hover:bg-muted/80',
                                            )}
                                        >
                                            <div className="flex items-start gap-3">
                                                 <div style={{color: segment.color}} className="font-bold text-lg h-5 w-5 flex items-center justify-center flex-shrink-0 mt-1">
                                                    ●
                                                 </div>
                                                 <div className="flex-1">
                                                    <p className="font-medium">{segment.label}</p>
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                                                        {segment.travelTime && <span className='flex items-center gap-1'><Route className="h-3 w-3"/>{segment.travelTime}</span>}
                                                        {segment.stopTime && <span className='flex items-center gap-1'><Timer className="h-3 w-3"/>{segment.stopTime}</span>}
                                                        {segment.distance && <span className='flex items-center gap-1'><Milestone className="h-3 w-3"/>{segment.distance}</span>}
                                                    </div>
                                                 </div>
                                                 <Icon className={cn("h-5 w-5 flex-shrink-0 mt-1", color)} />
                                            </div>
                                             {segment.id === 'segment-current' ? null : (
                                                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground pt-2 mt-2 border-t border-border/50 pl-8">
                                                    <div className="flex items-center gap-1"><Car className="h-3 w-3"/>Ocup: {segment.collectedOccupiedCars ?? 'N/A'}</div>
                                                    <div className="flex items-center gap-1"><Package className="h-3 w-3"/>Vaz: {segment.collectedEmptyCars ?? 'N/A'}</div>
                                                    <div className="flex items-center gap-1"><Warehouse className="h-3 w-3"/>Lotação: {segment.occupancy ?? 'N/A'}%</div>
                                                </div>
                                             )}
                                             {segment.observation && (
                                                <div className="text-xs text-muted-foreground pt-2 mt-2 border-t border-border/50 pl-8">
                                                    <strong>Obs:</strong> {segment.observation}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

    