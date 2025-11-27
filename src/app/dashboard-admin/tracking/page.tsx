
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, Clock, MapPin, Truck, User, Route, Timer, X, Hourglass } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { format, formatDistanceStrict, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';

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

export type Segment = {
    label: string;
    path: [number, number][];
    color: string;
    travelTime: string;
    stopTime: string;
    distance?: string;
}

type UserData = {
  name: string;
  isAdmin: boolean;
  companyId: string;
  sectorId: string;
};

const RealTimeMap = dynamic(() => import('../RealTimeMap'), {
  ssr: false,
  loading: () => <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
});

const SEGMENT_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#ec4899', 
    '#6366f1', '#f59e0b', '#14b8a6', '#d946ef'
];

const formatTimeDiff = (start: Date, end: Date) => {
    if (!start || !end) return 'N/A';
    return formatDistanceStrict(end, start, { locale: ptBR, unit: 'minute' });
}

const processRunSegments = (run: AggregatedRun): Segment[] => {
    if (!run.locationHistory || run.locationHistory.length === 0) return [];
    
    const sortedLocations = [...run.locationHistory].sort((a,b) => a.timestamp.seconds - b.timestamp.seconds);
    const sortedStops = [...run.stops].filter(s => s.status === 'COMPLETED' || s.status === 'IN_PROGRESS').sort((a, b) => (a.arrivalTime?.seconds || Infinity) - (b.arrivalTime?.seconds || Infinity));

    const segments: Segment[] = [];
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
        
        // Add the start point of the segment
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
            label: `Trajeto para ${stop.name}`,
            path: segmentPath,
            color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            travelTime: formatTimeDiff(new Date(lastDepartureTime.seconds * 1000), stopArrivalTime),
            stopTime: stopDepartureTime ? formatTimeDiff(stopArrivalTime, stopDepartureTime) : 'Em andamento',
            distance: segmentDistance !== null ? `${segmentDistance.toFixed(1)} km` : undefined
        });
        
        if (stop.departureTime) {
            lastDepartureTime = stop.departureTime;
        }
        if (stop.mileageAtStop) {
            lastMileage = stop.mileageAtStop;
        }
    }

    return segments;
}


const TrackingPage = () => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [user, setUser] = useState<UserData | null>(null);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [users, setUsers] = useState<Map<string, FirestoreUser>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRunIdForMap, setSelectedRunIdForMap] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

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
    // This query might require an index. We handle the error by falling back to a client-side filter.
    const completedRunsQuery = query(runsCol, where('status', '==', 'COMPLETED'));

    const handleSnapshots = (inProgressRuns: Run[], completedRuns: Run[]) => {
        const completedToday = completedRuns.filter(run => run.endTime && isToday(run.endTime.toDate()));
        
        // Use a map to ensure in-progress runs overwrite completed ones if IDs conflict (shouldn't happen with good data)
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
        // This query can fail if the index is not created. We'll fall back to client-side filtering.
        if (error.code === 'failed-precondition') {
          console.warn("Firestore index for completed runs query is not created. Filtering on the client.");
          const allRunsQuery = query(runsCol); // Fetch all runs for the sector
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
            // Group by vehicle, shift, and date
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
            // Use last run's endMileage if it exists, otherwise use last stop's mileage
            const endMileage = lastRun.endMileage ?? allStops.filter(s => s.mileageAtStop).slice(-1)[0]?.mileageAtStop ?? null;
            const totalDistance = (endMileage && startMileage) ? endMileage - startMileage : 0;
            const status = runs.some(r => r.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : 'COMPLETED';


            aggregated.push({
                key, // Using the group key for the accordion item
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


  const handleViewRoute = (runKey: string) => {
      const run = aggregatedRuns.find(r => r.key === runKey);
      if (!run || !run.locationHistory || run.locationHistory.length < 1) {
          toast({ variant: 'destructive', title: 'Sem dados', description: 'Não há dados de localização suficientes para exibir o trajeto.' });
          return;
      }
      setSelectedRunIdForMap(runKey);
  };

  const selectedRunForMap = useMemo(() => {
    if (!selectedRunIdForMap) return null;
    return aggregatedRuns.find(run => run.key === selectedRunIdForMap) || null;
  }, [selectedRunIdForMap, aggregatedRuns]);


  if (isLoading) {
     return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  
  const mapSegments = selectedRunForMap ? processRunSegments(selectedRunForMap) : [];
  const fullLocationHistory = selectedRunForMap?.locationHistory?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || [];

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
            {aggregatedRuns.map(run => <RunAccordionItem key={run.key} run={run} onViewRoute={() => handleViewRoute(run.key)} />)}
          </Accordion>
        )}
      
      <Dialog open={selectedRunForMap !== null} onOpenChange={(isOpen) => !isOpen && setSelectedRunIdForMap(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          {isClient && selectedRunForMap && (
            <>
                <DialogHeader>
                    <DialogTitle>Acompanhamento da Rota - {selectedRunForMap.driverName} ({selectedRunForMap.vehicleId})</DialogTitle>
                    <DialogDescription>
                        Acompanhe a localização em tempo real ou veja o trajeto detalhado da rota.
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="location" className="h-[calc(80vh-120px)]">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="location">Localização Atual</TabsTrigger>
                        <TabsTrigger value="route">Trajeto Detalhado</TabsTrigger>
                    </TabsList>
                    <TabsContent value="location" className="h-[calc(100%-40px)] bg-muted rounded-md">
                        <RealTimeMap
                            fullLocationHistory={fullLocationHistory}
                            vehicleId={selectedRunForMap.vehicleId}
                        />
                    </TabsContent>
                    <TabsContent value="route" className="h-[calc(100%-40px)] bg-muted rounded-md">
                        <RealTimeMap
                            segments={mapSegments}
                            fullLocationHistory={fullLocationHistory}
                            vehicleId={selectedRunForMap.vehicleId}
                        />
                    </TabsContent>
                </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const RunAccordionItem = ({ run, onViewRoute }: { run: AggregatedRun, onViewRoute: () => void }) => {
  const isCompletedRun = run.status === 'COMPLETED';
  const completedStops = run.stops.filter(s => s.status === 'COMPLETED').length;
  const totalStops = run.stops.filter(s => s.status !== 'CANCELED').length;
  const progress = isCompletedRun ? 100 : (totalStops > 0 ? (completedStops / totalStops) * 100 : 0);
  const currentStop = run.stops.find(s => s.status === 'IN_PROGRESS');

  const formatFirebaseTime = (timestamp: FirebaseTimestamp | null | undefined) => {
    if (!timestamp) return '--:--';
    return format(new Date(timestamp.seconds * 1000), 'HH:mm');
  };
  
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
             <Button variant="outline" size="sm" onClick={onViewRoute}>
                <Route className="mr-2 h-4 w-4"/> Ver Acompanhamento
            </Button>
          </div>
          {run.originalRuns.map((originalRun, runIndex) => {
            const previousRun = runIndex > 0 ? run.originalRuns[runIndex - 1] : null;
            let idleTime: string | null = null;

            if (previousRun) {
                const lastStopOfPreviousRun = previousRun.stops
                    .filter(s => s.status === 'COMPLETED' && s.arrivalTime)
                    .sort((a, b) => b.arrivalTime!.seconds - a.arrivalTime!.seconds)[0];

                if (lastStopOfPreviousRun && lastStopOfPreviousRun.arrivalTime) {
                    idleTime = formatDistanceStrict(
                        lastStopOfPreviousRun.arrivalTime.toDate(),
                        originalRun.startTime.toDate(),
                        { locale: ptBR, unit: 'minute' }
                    );
                }
            }
            
            let lastDepartureTime = originalRun.startTime;

            return (
              <div key={originalRun.id}>
                {idleTime && (
                  <div className="flex items-center gap-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 my-2">
                    <Hourglass className="h-6 w-6 flex-shrink-0 text-amber-500" />
                    <div className="flex-1">
                      <p className="font-medium">Tempo Parado</p>
                      <p className="text-xs text-muted-foreground">O veículo ficou ocioso entre as corridas.</p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <p>Duração: <strong>{idleTime}</strong></p>
                    </div>
                  </div>
                )}
                {originalRun.stops.map((stop, stopIndex) => {
                  const { icon: Icon, color, label } = getStatusInfo(stop.status);
                  if (stop.status === 'CANCELED') return null;

                  const isCompletedStop = stop.status === 'COMPLETED';
                  
                  const arrivalTime = stop.arrivalTime ? new Date(stop.arrivalTime.seconds * 1000) : null;
                  const departureTime = stop.departureTime ? new Date(stop.departureTime.seconds * 1000) : null;
                  
                  const travelStartTime = lastDepartureTime; 
                  
                  const travelTime = arrivalTime ? formatDistanceStrict(new Date(travelStartTime.seconds * 1000), arrivalTime, { locale: ptBR, unit: 'minute'}) : null;
                  const stopTime = arrivalTime && departureTime ? formatDistanceStrict(arrivalTime, departureTime, { locale: ptBR, unit: 'minute'}) : null;

                  if (stop.departureTime) {
                      lastDepartureTime = stop.departureTime!;
                  }

                  return (
                    <div key={stopIndex} className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 rounded-md ${isCompletedStop ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/20'}`}>
                      <Icon className={`h-6 w-6 flex-shrink-0 mt-1 sm:mt-0 ${color}`} />
                      <div className="flex-1">
                        <p className="font-medium">{stop.name}</p>
                        <p className={`text-xs ${isCompletedStop ? 'text-muted-foreground' : color}`}>{label}</p>
                      </div>
                      <div className="w-full sm:w-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {travelTime && <span className='flex items-center gap-1'><Route className="h-3 w-3 text-gray-400"/> Viagem: <strong>{travelTime}</strong></span>}
                          {stopTime && <span className='flex items-center gap-1'><Timer className="h-3 w-3 text-gray-400"/> Parada: <strong>{stopTime}</strong></span>}
                      </div>
                      {isCompletedStop && (
                        <div className="text-right text-sm text-muted-foreground">
                            <p>Início no trajeto: {formatFirebaseTime(travelStartTime)}</p>
                            <p>Encerramento: {formatFirebaseTime(stop.arrivalTime)}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default TrackingPage;
