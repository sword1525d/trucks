
'use client';
import { useState, useEffect, useMemo } from 'react';
import { useFirebase } from '@/firebase';
import { collection, query, where, onSnapshot, Timestamp, getDocs } from 'firebase/firestore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, Clock, MapPin, Truck, User, Route, Timer, X, Hourglass, Expand, Milestone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { format, formatDistanceStrict, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Segment } from '../history/page';

// --- Tipos ---
type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

type FirebaseTimestamp = Timestamp;

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: FirebaseTimestamp | null;
  departureTime: FirebaseTimestamp | null;
  collectedOccupiedCars?: number | null;
  collectedEmptyCars?: number | null;
  mileageAtStop?: number | null;
  occupancy?: number | null;
  observation?: string;
};

export type LocationPoint = {
  latitude: number;
  longitude: number;
  timestamp: FirebaseTimestamp;
};

export type Run = {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  startTime: FirebaseTimestamp;
  startMileage: number;
  endTime?: FirebaseTimestamp | null;
  endMileage?: number | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  stops: Stop[];
  locationHistory?: LocationPoint[];
};

export type AggregatedRun = {
    key: string;
    driverId: string;
    driverName: string;
    vehicleId: string;
    shift: string;
    date: string;
    startTime: FirebaseTimestamp;
    endTime: FirebaseTimestamp | null;
    totalDistance: number;
    stops: Stop[];
    locationHistory: LocationPoint[];
    originalRuns: Run[];
    startMileage: number;
    status: 'IN_PROGRESS' | 'COMPLETED';
};


export type FirestoreUser = {
  id: string;
  name:string;
  shift?: string;
}

type UserData = {
  name: string;
  isAdmin: boolean;
  companyId: string;
  sectorId: string;
};

const RealTimeMap = dynamic(() => import('../RealTimeMap'), {
  ssr: false,
  loading: () => <div className="flex justify-center items-center bg-muted/50 h-full w-full rounded-md"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
});


const TrackingPage = () => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [user, setUser] = useState<UserData | null>(null);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [users, setUsers] = useState<Map<string, FirestoreUser>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<AggregatedRun | null>(null);


  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (storedUser && companyId && sectorId) {
      setUser({ ...JSON.parse(storedUser), companyId, sectorId });
    } else {
      toast({ variant: 'destructive', title: 'Sessão inválida', description: 'Faça login novamente.' });
      router.push('/login');
    }
  }, [router, toast]);
  
  useEffect(() => {
    if (!firestore || !user) return;

    setIsLoading(true);

    // Fetch Users first
    const usersCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/users`);
    getDocs(usersCol).then(usersSnapshot => {
        const usersMap = new Map<string, FirestoreUser>();
        usersSnapshot.forEach(doc => {
            usersMap.set(doc.id, { id: doc.id, ...doc.data() } as FirestoreUser);
        });
        setUsers(usersMap);
    });

    const runsCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`);
    
    const activeRunsQuery = query(runsCol, where('status', '==', 'IN_PROGRESS'));
    const completedRunsQuery = query(runsCol, where('status', '==', 'COMPLETED'));

    const handleSnapshots = (inProgressRuns: Run[], completedRuns: Run[]) => {
        const completedToday = completedRuns.filter(run => run.endTime && isToday(run.endTime.toDate()));
        
        const allRunsMap = new Map<string, Run>();

        [...completedToday, ...inProgressRuns].forEach(run => {
            allRunsMap.set(run.id, run);
        });

        const combinedRuns = Array.from(allRunsMap.values());
        
        setAllRuns(combinedRuns);
        setIsLoading(false);
    };

    let inProgressRuns: Run[] = [];
    let completedRuns: Run[] = [];

    const unsubscribeInProgress = onSnapshot(activeRunsQuery, (snapshot) => {
        inProgressRuns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
        handleSnapshots(inProgressRuns, completedRuns);
    }, (error) => {
        console.error("Error fetching active runs: ", error);
        toast({ variant: 'destructive', title: 'Erro ao buscar corridas ativas' });
        setIsLoading(false);
    });

    const unsubscribeCompleted = onSnapshot(completedRunsQuery, (snapshot) => {
        completedRuns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
        handleSnapshots(inProgressRuns, completedRuns);
    }, (error) => {
        if (error.code === 'failed-precondition') {
          console.warn("Firestore index for completed runs query is not created. Filtering on the client.");
          const allRunsQuery = query(runsCol);
          const unsubscribeAll = onSnapshot(allRunsQuery, (allDocsSnapshot) => {
            const allDocs = allDocsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as Run}));
            inProgressRuns = allDocs.filter(r => r.status === 'IN_PROGRESS');
            completedRuns = allDocs.filter(r => r.status === 'COMPLETED');
            handleSnapshots(inProgressRuns, completedRuns);
          });
          return unsubscribeAll;
        } else {
          toast({ variant: 'destructive', title: 'Erro ao buscar corridas concluídas' });
        }
        setIsLoading(false);
    });

    return () => {
        unsubscribeInProgress();
        unsubscribeCompleted();
    };
  }, [firestore, user, toast]);

 const aggregatedRuns = useMemo(() => {
        const groupedRuns = new Map<string, Run[]>();
        allRuns.forEach(run => {
            const driver = users.get(run.driverId);
            const runDate = format(run.startTime.toDate(), 'yyyy-MM-dd');
            const key = `${run.vehicleId}-${driver?.shift || 'sem-turno'}-${runDate}`;
            
            if (!groupedRuns.has(key)) {
                groupedRuns.set(key, []);
            }
            groupedRuns.get(key)!.push(run);
        });

        const aggregated: AggregatedRun[] = [];
        groupedRuns.forEach((runs, key) => {
            runs.sort((a,b) => a.startTime.seconds - b.startTime.seconds);
            const firstRun = runs[0];
            const lastRun = runs[runs.length - 1];
            const driver = users.get(firstRun.driverId);

            const allStops = runs.flatMap(r => r.stops).sort((a,b) => (a.arrivalTime?.seconds || 0) - (b.arrivalTime?.seconds || 0));
            const allLocations = runs.flatMap(r => r.locationHistory || []).sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);
            
            const startMileage = firstRun.startMileage;
            const endMileage = lastRun.endMileage ?? allStops.filter(s => s.mileageAtStop).slice(-1)[0]?.mileageAtStop ?? null;
            const totalDistance = (endMileage && startMileage) ? endMileage - startMileage : 0;
            const status = runs.some(r => r.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : 'COMPLETED';


            aggregated.push({
                key,
                driverId: firstRun.driverId,
                driverName: firstRun.driverName,
                vehicleId: firstRun.vehicleId,
                shift: driver?.shift || 'N/A',
                date: format(firstRun.startTime.toDate(), 'dd/MM/yyyy'),
                startTime: firstRun.startTime,
                endTime: lastRun.endTime,
                totalDistance: totalDistance,
                stops: allStops,
                locationHistory: allLocations,
                originalRuns: runs,
                startMileage: startMileage,
                status: status,
            });
        });
        
        return aggregated.sort((a, b) => b.startTime.seconds - a.startTime.seconds);
    }, [allRuns, users]);


  const handleViewDetails = (runKey: string) => {
      const run = aggregatedRuns.find(r => r.key === runKey);
      if (!run || !run.locationHistory || run.locationHistory.length < 1) {
          toast({ variant: 'destructive', title: 'Sem dados', description: 'Não há dados de localização suficientes para exibir o trajeto.' });
          return;
      }
      setSelectedRun(run);
  };

  if (isLoading) {
     return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  
  return (
    <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Acompanhamento Diário</h2>
        </div>
        
        {aggregatedRuns.length === 0 ? (
            <Card className="text-center p-8 mt-6 max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle>Nenhuma atividade hoje</CardTitle>
                    <CardDescription>Não há motoristas em rota ou corridas finalizadas hoje.</CardDescription>
                </CardHeader>
            </Card>
        ) : (
          <Accordion type="single" collapsible className="w-full space-y-4" defaultValue={aggregatedRuns.find(r => r.status === 'IN_PROGRESS')?.key || aggregatedRuns[0]?.key}>
            {aggregatedRuns.map(run => <RunAccordionItem key={run.key} run={run} onViewDetails={() => handleViewDetails(run.key)} />)}
          </Accordion>
        )}
        <RunDetailsDialog isOpen={!!selectedRun} onClose={() => setSelectedRun(null)} run={selectedRun} />
    </div>
  );
};

const RunAccordionItem = ({ run, onViewDetails }: { run: AggregatedRun, onViewDetails: () => void }) => {
  const isCompletedRun = run.status === 'COMPLETED';
  const completedStops = run.stops.filter(s => s.status === 'COMPLETED').length;
  const totalStops = run.stops.filter(s => s.status !== 'CANCELED').length;
  const progress = isCompletedRun ? 100 : (totalStops > 0 ? (completedStops / totalStops) * 100 : 0);
  const currentStop = run.stops.find(s => s.status === 'IN_PROGRESS');

  const formatFirebaseTime = (timestamp: FirebaseTimestamp | null | undefined) => {
    if (!timestamp) return '--:--';
    return format(new Date(timestamp.seconds * 1000), 'HH:mm');
  };

  return (
    <AccordionItem value={run.key} className="bg-card border rounded-lg shadow-sm">
      <AccordionTrigger className="p-4 hover:no-underline">
        <div className="w-full flex flex-col sm:flex-row justify-between items-start sm:items-center text-left gap-4 sm:gap-2">
          <div className="flex-1 min-w-0">
              <p className="font-bold text-lg text-primary truncate flex items-center gap-2"><User className="h-5 w-5" />{run.driverName}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Truck className="h-4 w-4" />{run.vehicleId} ({run.shift})</p>
          </div>
          <div className="flex-1 w-full sm:w-auto">
              <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{isCompletedRun ? 'Concluído' : `${completedStops} de ${totalStops}`}</span>
                  <span className="font-bold text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
          </div>
          <div className="flex-none">
               <Badge variant={isCompletedRun ? 'default' : (currentStop ? "default" : "secondary")} className={`truncate ${isCompletedRun ? 'bg-green-600' : ''}`}>
                 <MapPin className="h-3 w-3 mr-1.5"/>
                 {isCompletedRun ? `Finalizado às ${formatFirebaseTime(run.endTime)}` : (currentStop ? currentStop.name : 'Iniciando...')}
               </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0">
        <div className="space-y-4 mt-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">Detalhes da Rota</h4>
             <Button variant="outline" size="sm" onClick={onViewDetails}>
                <Route className="mr-2 h-4 w-4"/> Ver Detalhes
            </Button>
          </div>
          <RunDetailsContent run={run} />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

const RunDetailsContent = ({ run }: { run: AggregatedRun }) => {
    const getStatusInfo = (status: StopStatus) => {
        switch (status) {
        case 'COMPLETED': return { icon: CheckCircle, color: 'text-green-500', label: 'Concluído' };
        case 'IN_PROGRESS': return { icon: PlayCircle, color: 'text-blue-500', label: 'Em Andamento' };
        case 'PENDING': return { icon: Clock, color: 'text-gray-500', label: 'Pendente' };
        case 'CANCELED': return { icon: X, color: 'text-red-500', label: 'Cancelado' };
        default: return { icon: Clock, color: 'text-gray-500', label: 'Pendente' };
        }
    };
    
    return (
        <div className="space-y-2">
          {run.originalRuns.map((originalRun, runIndex) => {
            const previousRun = runIndex > 0 ? run.originalRuns[runIndex - 1] : null;
            let idleTime: string | null = null;

            if (previousRun && previousRun.endTime) {
                idleTime = formatDistanceStrict(
                    previousRun.endTime.toDate(),
                    originalRun.startTime.toDate(),
                    { locale: ptBR, unit: 'minute' }
                );
            }
            
            let lastDepartureTime = originalRun.startTime;

            return (
              <div key={originalRun.id}>
                {idleTime && parseFloat(idleTime) > 0 && (
                  <div className="flex items-center gap-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 my-2">
                    <Hourglass className="h-6 w-6 flex-shrink-0 text-amber-500" />
                    <div className="flex-1">
                      <p className="font-medium">Tempo Parado</p>
                      <p className="text-xs text-muted-foreground">O veículo ficou parado entre as corridas.</p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <p><strong>{idleTime}</strong></p>
                    </div>
                  </div>
                )}
                {originalRun.stops.map((stop) => {
                  const { icon: Icon, color, label } = getStatusInfo(stop.status);
                  if (stop.status === 'CANCELED') return null;

                  const isCompletedStop = stop.status === 'COMPLETED';
                  
                  const arrivalTime = stop.arrivalTime ? new Date(stop.arrivalTime.seconds * 1000) : null;
                  const departureTime = stop.departureTime ? new Date(stop.departureTime.seconds * 1000) : null;
                  
                  const travelStartTime = lastDepartureTime; 
                  
                  const travelTime = arrivalTime ? formatDistanceStrict(new Date(travelStartTime.seconds * 1000), arrivalTime, { locale: ptBR, unit: 'minute'}) : null;
                  const stopTime = arrivalTime && departureTime ? formatDistanceStrict(arrivalTime, departureTime, { locale: ptBR, unit: 'minute'}) : null;
                  const distance = (stop.mileageAtStop && originalRun.startMileage) ? `${(stop.mileageAtStop - originalRun.startMileage).toFixed(1)} km` : null;

                  if (stop.departureTime) {
                      lastDepartureTime = stop.departureTime!;
                  }

                  return (
                    <div 
                        key={`${originalRun.id}-${stop.name}`} 
                        className={`flex items-start gap-4 p-3 rounded-md ${isCompletedStop ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/20'}`}
                    >
                      <Icon className={`h-5 w-5 flex-shrink-0 mt-1 ${color}`} />
                      <div className="flex-1">
                        <p className="font-medium">{stop.name}</p>
                        <p className={`text-xs ${isCompletedStop ? 'text-muted-foreground' : color}`}>{label}</p>
                         <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                          {travelTime && <span className='flex items-center gap-1'><Route className="h-3 w-3 text-gray-400"/> Viagem: <strong>{travelTime}</strong></span>}
                          {stopTime && <span className='flex items-center gap-1'><Timer className="h-3 w-3 text-gray-400"/> Parada: <strong>{stopTime}</strong></span>}
                          {distance && <span className='flex items-center gap-1'><Milestone className="h-3 w-3 text-gray-400"/> Distância: <strong>{distance}</strong></span>}
                        </div>
                         {stop.observation && (
                            <div className="border-t mt-2 pt-2">
                                <p className="text-xs text-muted-foreground"><strong>Obs:</strong> {stop.observation}</p>
                            </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
    )
}

const SEGMENT_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#ec4899', 
    '#6366f1', '#f59e0b', '#14b8a6', '#d946ef'
];


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

const RunDetailsDialog = ({ isOpen, onClose, run }: { isOpen: boolean, onClose: () => void, run: AggregatedRun | null }) => {
    const router = useRouter();
    const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);

    const segments = useMemo(() => {
        if (!run) return [];
        return processRunSegments(run);
    }, [run]);

    const displayedSegments = useMemo(() => {
        if (!highlightedSegmentId) return segments.map(s => ({ ...s, opacity: 0.9 }));
        
        return segments.map(s => ({
            ...s,
            opacity: s.id === highlightedSegmentId ? 1.0 : 0.3,
        }));
    }, [segments, highlightedSegmentId]);
    
    const handleFullScreen = () => {
        if (run) {
            router.push(`/dashboard-admin/map-view/${encodeURIComponent(run.key)}`);
        }
    };

    if (!run) return null;

    const getStatusInfo = (status: StopStatus) => {
        switch (status) {
            case 'COMPLETED': return { icon: CheckCircle, color: 'text-green-500' };
            case 'IN_PROGRESS': return { icon: PlayCircle, color: 'text-blue-500' };
            default: return { icon: Clock, color: 'text-gray-400' };
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-6xl w-full h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle>Detalhes da Rota - {run.driverName} ({run.vehicleId})</DialogTitle>
                    <DialogDescription>{run.date} - {run.shift}</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 flex-1 min-h-0">
                    <div className="lg:col-span-2 relative h-full min-h-[300px] lg:min-h-0 border-r">
                        <RealTimeMap
                            segments={displayedSegments}
                            fullLocationHistory={run.locationHistory?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || []}
                            vehicleId={run.vehicleId}
                        />
                        <div className="absolute top-2 right-2 z-10">
                            <Button size="icon" variant="outline" onClick={handleFullScreen} className="bg-background/80 hover:bg-background">
                                <Expand className="h-5 w-5"/>
                            </Button>
                        </div>
                    </div>
                    <div className="lg:col-span-1 flex flex-col min-h-0">
                        <ScrollArea className="flex-1">
                            <div className="p-4 space-y-2">
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
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};


export default TrackingPage;
