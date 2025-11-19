
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs, onSnapshot, orderBy } from 'firebase/firestore';
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
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, Clock, MapPin, Truck, User, LineChart, Calendar as CalendarIcon, Route, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { format, subDays, startOfDay, endOfDay, formatDistanceStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import dynamic from 'next/dynamic';
import Link from 'next/link';


// --- Tipos ---
type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
type RunStatus = 'IN_PROGRESS' | 'COMPLETED';

type FirebaseTimestamp = {
  seconds: number;
  nanoseconds: number;
};

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: FirebaseTimestamp | null;
  departureTime: FirebaseTimestamp | null;
};

export type LocationPoint = {
  latitude: number;
  longitude: number;
  timestamp: FirebaseTimestamp;
};

export type Run = {
  id: string;
  driverName: string;
  vehicleId: string;
  startMileage: number;
  endMileage: number | null;
  startTime: FirebaseTimestamp;
  endTime: FirebaseTimestamp | null;
  status: RunStatus;
  stops: Stop[];
  locationHistory?: LocationPoint[];
};

export type Segment = {
    label: string;
    path: [number, number][];
    color: string;
    travelTime: string;
    stopTime: string;
}

type UserData = {
  name: string;
  isAdmin: boolean;
  companyId: string;
  sectorId: string;
};

export type Vehicle = {
  id: string;
  model: string;
  isTruck: boolean;
};

type VehicleStatus = Vehicle & {
  status: 'EM CORRIDA' | 'PARADO';
  driverName?: string;
}

// Carregamento dinâmico do mapa para evitar problemas com SSR
const RealTimeMap = dynamic(() => import('./RealTimeMap'), {
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

const processRunSegments = (run: Run): Segment[] => {
    if (!run.locationHistory || run.locationHistory.length === 0) return [];
    
    const sortedLocations = [...run.locationHistory].sort((a,b) => a.timestamp.seconds - b.timestamp.seconds);
    const sortedStops = [...run.stops].filter(s => s.status !== 'CANCELED').sort((a, b) => (a.arrivalTime?.seconds || 0) - (b.arrivalTime?.seconds || 0));

    const segments: Segment[] = [];
    let lastDepartureTime = run.startTime;

    for(let i = 0; i < sortedStops.length; i++) {
        const stop = sortedStops[i];
        if (!stop.arrivalTime) continue;

        const stopArrivalTime = new Date(stop.arrivalTime.seconds * 1000);
        const stopDepartureTime = stop.departureTime ? new Date(stop.departureTime.seconds * 1000) : null;

        const segmentPath = sortedLocations
            .filter(loc => {
                const locTime = loc.timestamp.seconds;
                return locTime >= lastDepartureTime.seconds && locTime <= stop.arrivalTime!.seconds;
            })
            .map(loc => [loc.longitude, loc.latitude] as [number, number]);

        // Adiciona a primeira localização da parada para fechar o trajeto
        if(segmentPath.length > 0 && i > 0) {
           const prevStop = sortedStops[i-1];
           const prevStopTime = prevStop.departureTime ? new Date(prevStop.departureTime.seconds * 1000) : null;
           if(prevStopTime) {
              const firstPointOfCurrentSegment = sortedLocations.find(l => l.timestamp.seconds >= prevStopTime.getTime() / 1000);
              if(firstPointOfCurrentSegment) {
                 segmentPath.unshift([firstPointOfCurrentSegment.longitude, firstPointOfCurrentSegment.latitude]);
              }
           }
        }
        
        segments.push({
            label: `Trajeto para ${stop.name}`,
            path: segmentPath,
            color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            travelTime: formatTimeDiff(new Date(lastDepartureTime.seconds * 1000), stopArrivalTime),
            stopTime: stopDepartureTime ? formatTimeDiff(stopArrivalTime, stopDepartureTime) : 'Em andamento',
        });
        
        if (stopDepartureTime) {
            lastDepartureTime = stop.departureTime!;
        }
    }

    return segments;
}


// --- Componente Principal ---
const AdminDashboardPage = () => {
  const { firestore, auth } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [user, setUser] = useState<UserData | null>(null);
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  const [vehicleStatuses, setVehicleStatuses] = useState<VehicleStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRunForMap, setSelectedRunForMap] = useState<Run | null>(null);

  // Efeito para carregar dados do usuário da sessão
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (storedUser && companyId && sectorId) {
      const parsedUser = JSON.parse(storedUser);
      if (!parsedUser.isAdmin) {
          toast({ variant: 'destructive', title: 'Acesso Negado', description: 'Você não tem permissão para acessar esta página.' });
          router.push('/login');
          return;
      }
      setUser({ ...parsedUser, companyId, sectorId });
    } else {
      toast({ variant: 'destructive', title: 'Sessão inválida', description: 'Faça login novamente.' });
      router.push('/login');
    }
  }, [router, toast]);
  
  // Efeito para buscar todos os dados (corridas e veículos)
  useEffect(() => {
    if (!firestore || !user) return;

    setIsLoading(true);
    
    // 1. Fetch all trucks once
    const fetchAllTrucks = async () => {
        try {
            const vehiclesCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/vehicles`);
            const vehiclesQuery = query(vehiclesCol, where('isTruck', '==', true));
            const vehiclesSnapshot = await getDocs(vehiclesQuery);
            return vehiclesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
        } catch (error) {
            console.error("Error fetching vehicles: ", error);
            toast({ variant: 'destructive', title: 'Erro ao buscar veículos', description: 'Não foi possível carregar os dados da frota.' });
            return [];
        }
    };

    // 2. Setup real-time listener for active runs
    const runsCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`);
    const activeRunsQuery = query(runsCol, where('status', '==', 'IN_PROGRESS'));

    const unsubscribe = onSnapshot(activeRunsQuery, async (querySnapshot) => {
        const runs: Run[] = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
        const sortedRuns = runs.sort((a, b) => a.startTime.seconds - b.startTime.seconds);
        setActiveRuns(sortedRuns);

        // 3. Update vehicle statuses based on active runs
        const allTrucks = await fetchAllTrucks();
        const activeRunsMap = new Map(runs.map(run => [run.vehicleId, run.driverName]));

        const statuses = allTrucks.map(truck => ({
            ...truck,
            status: activeRunsMap.has(truck.id) ? 'EM CORRIDA' : 'PARADO',
            driverName: activeRunsMap.get(truck.id)
        } as VehicleStatus));

        setVehicleStatuses(statuses);
        setIsLoading(false);
    }, (error) => {
      console.error("Error fetching active runs: ", error);
      toast({ variant: 'destructive', title: 'Erro ao buscar dados', description: 'Não foi possível carregar os acompanhamentos ativos.' });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, user, toast]);

    const fetchCompletedRuns = useCallback(async (): Promise<Run[]> => {
        if (!firestore || !user) return [];

        const runsQuery = query(
            collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`),
            where('status', '==', 'COMPLETED')
        );

        try {
            const querySnapshot = await getDocs(runsQuery);
            const runs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
            // Ordena os resultados no cliente
            return runs.sort((a, b) => (b.endTime?.seconds || 0) - (a.endTime?.seconds || 0));
        } catch (error) {
            console.error("Error fetching completed runs: ", error);
            toast({ variant: 'destructive', title: 'Erro ao buscar histórico', description: 'Não foi possível carregar o histórico. Tente recarregar a página.' });
            return [];
        }
    }, [firestore, user, toast]);

    const handleViewRoute = (run: Run) => {
        if (!run.locationHistory || run.locationHistory.length < 1) {
            toast({ variant: 'destructive', title: 'Sem dados', description: 'Não há dados de localização suficientes para exibir o trajeto.' });
            return;
        }
        setSelectedRunForMap(run);
    };


  if (!user || isLoading) {
     return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const mapSegments = selectedRunForMap ? processRunSegments(selectedRunForMap) : [];
  const fullLocationHistory = selectedRunForMap?.locationHistory || [];


  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-black">
      <Header />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6">
        
        <FleetStatusDashboard vehicleStatuses={vehicleStatuses} isLoading={isLoading} />

        <Tabs defaultValue="realtime" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-lg mx-auto mb-6">
              <TabsTrigger value="realtime"><PlayCircle className="mr-2"/> Acompanhamentos Ativos</TabsTrigger>
              <TabsTrigger value="history"><LineChart className="mr-2"/> Histórico e Análise</TabsTrigger>
            </TabsList>
            <TabsContent value="realtime">
                <RealTimeDashboard 
                  activeRuns={activeRuns} 
                  isLoading={isLoading}
                  onViewRoute={handleViewRoute}
                />
            </TabsContent>
            <TabsContent value="history">
                <HistoryDashboard 
                  fetchCompletedRuns={fetchCompletedRuns} 
                  onViewRoute={handleViewRoute}
                />
            </TabsContent>
        </Tabs>
      </main>
      
      {/* Modal para exibir o mapa */}
      <Dialog open={selectedRunForMap !== null} onOpenChange={(isOpen) => !isOpen && setSelectedRunForMap(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Trajeto da Corrida - {selectedRunForMap?.driverName} ({selectedRunForMap?.vehicleId})</DialogTitle>
            <DialogDescription>
              Visualização do trajeto completo da corrida, segmentado por paradas.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[calc(80vh-100px)] bg-muted rounded-md">
            {selectedRunForMap && (
              <RealTimeMap segments={mapSegments} fullLocationHistory={fullLocationHistory} />
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

// --- Componente Header ---
const Header = () => {
    const [time, setTime] = useState(new Date());
    const router = useRouter();
    const { auth } = useFirebase();

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000 * 30);
        return () => clearInterval(timer);
    }, []);

    const handleLogout = () => {
        if (auth && confirm('Tem certeza que deseja sair da conta?')) {
            auth.signOut();
            localStorage.clear();
            router.push('/login');
        }
    };


    return (
     <header className="flex-shrink-0 bg-background/75 backdrop-blur-lg border-b sticky top-0 z-10 px-4 sm:px-6 lg:px-8">
       <div className="flex h-16 items-center justify-between">
         <div>
          <h1 className="text-xl font-bold text-primary">Dashboard de Acompanhamento</h1>
          <p className="text-sm text-muted-foreground">
            {format(time, "eeee, dd 'de' MMMM, HH:mm", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2">
            <Link href="/dashboard-admin/manage">
                <Button variant="outline">
                    <Settings className="mr-2 h-4 w-4"/>
                    Gerenciar
                </Button>
            </Link>
            <Button onClick={handleLogout} variant="outline">Sair</Button>
        </div>
       </div>
      </header>
    );
};

const FleetStatusDashboard = ({ vehicleStatuses, isLoading }: { vehicleStatuses: VehicleStatus[], isLoading: boolean }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck className="h-6 w-6"/> Status da Frota</CardTitle>
        <CardDescription>Visão geral de todos os caminhões do setor.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : vehicleStatuses.length === 0 ? (
          <p className="text-muted-foreground text-center">Nenhum caminhão encontrado neste setor.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {vehicleStatuses.map(vehicle => (
              <VehicleStatusCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const VehicleStatusCard = ({ vehicle }: { vehicle: VehicleStatus }) => {
  const isRunning = vehicle.status === 'EM CORRIDA';
  return (
    <Card className={`flex flex-col items-center justify-center p-4 text-center ${isRunning ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-800/30'}`}>
        <p className="font-bold text-lg">{vehicle.id}</p>
        <p className="text-xs text-muted-foreground -mt-1 mb-2">{vehicle.model}</p>
        <Badge variant={isRunning ? 'default' : 'secondary'} className={isRunning ? 'bg-blue-600' : ''}>
            {vehicle.status}
        </Badge>
        {isRunning && vehicle.driverName && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <User className="h-3 w-3"/>{vehicle.driverName}
            </p>
        )}
    </Card>
  )
}


// --- Componente Aba Tempo Real ---
const RealTimeDashboard = ({ activeRuns, isLoading, onViewRoute }: { activeRuns: Run[], isLoading: boolean, onViewRoute: (run: Run) => void }) => {
  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (activeRuns.length === 0) {
    return (
        <Card className="text-center p-8 mt-6 max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle>Nenhum acompanhamento ativo</CardTitle>
                <CardDescription>Não há motoristas em rota no momento.</CardDescription>
            </CardHeader>
        </Card>
    );
  }
  
  return (
      <Accordion type="single" collapsible className="w-full space-y-4 max-w-4xl mx-auto" defaultValue={activeRuns[0]?.id}>
        {activeRuns.map(run => <RunAccordionItem key={run.id} run={run} onViewRoute={() => onViewRoute(run)} />)}
      </Accordion>
  );
};

// --- Componente Item do Acordeão de Corrida ---
const RunAccordionItem = ({ run, onViewRoute }: { run: Run, onViewRoute: () => void }) => {
  const completedStops = run.stops.filter(s => s.status === 'COMPLETED').length;
  const totalStops = run.stops.filter(s => s.status !== 'CANCELED').length;
  const progress = totalStops > 0 ? (completedStops / totalStops) * 100 : 0;
  const currentStop = run.stops.find(s => s.status === 'IN_PROGRESS');

  const formatFirebaseTime = (timestamp: FirebaseTimestamp | null) => {
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

  let lastDepartureTime = run.startTime;

  return (
    <AccordionItem value={run.id} className="bg-card border rounded-lg shadow-sm">
      <AccordionTrigger className="p-4 hover:no-underline">
        <div className="w-full flex flex-col sm:flex-row justify-between items-start sm:items-center text-left gap-4 sm:gap-2">
          <div className="flex-1 min-w-0">
              <p className="font-bold text-lg text-primary truncate flex items-center gap-2"><User className="h-5 w-5" />{run.driverName}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Truck className="h-4 w-4" />{run.vehicleId}</p>
          </div>
          <div className="flex-1 w-full sm:w-auto">
              <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{completedStops} de {totalStops}</span>
                  <span className="font-bold text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
          </div>
          <div className="flex-none">
               <Badge variant={currentStop ? "default" : "secondary"} className="truncate">
                 <MapPin className="h-3 w-3 mr-1.5"/>
                 {currentStop ? currentStop.name : (progress === 100 ? 'Finalizado' : 'Iniciando...')}
               </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0">
        <div className="space-y-4 mt-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">Detalhes da Rota</h4>
             <Button variant="outline" size="sm" onClick={onViewRoute}>
                <Route className="mr-2 h-4 w-4"/> Ver Trajeto Detalhado
            </Button>
          </div>
          {run.stops.map((stop, index) => {
            const { icon: Icon, color, label } = getStatusInfo(stop.status);
            if (stop.status === 'CANCELED') return null;

            const isCompleted = stop.status === 'COMPLETED';
            
            const arrivalTime = stop.arrivalTime ? new Date(stop.arrivalTime.seconds * 1000) : null;
            const departureTime = stop.departureTime ? new Date(stop.departureTime.seconds * 1000) : null;
            const prevDepartureTime = new Date(lastDepartureTime.seconds * 1000);
            
            const travelTime = arrivalTime ? formatTimeDiff(prevDepartureTime, arrivalTime) : null;
            const stopTime = arrivalTime && departureTime ? formatTimeDiff(arrivalTime, departureTime) : null;

            if (departureTime) {
                lastDepartureTime = stop.departureTime!;
            }

            return (
              <div key={index} className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 rounded-md ${isCompleted ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/20'}`}>
                 <Icon className={`h-6 w-6 flex-shrink-0 mt-1 sm:mt-0 ${color}`} />
                 <div className="flex-1">
                   <p className="font-medium">{index + 1}. {stop.name}</p>
                   <p className={`text-xs ${isCompleted ? 'text-muted-foreground' : color}`}>{label}</p>
                 </div>
                 <div className="w-full sm:w-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {travelTime && <span className='flex items-center gap-1'><Route className="h-3 w-3 text-gray-400"/> Viagem: <strong>{travelTime}</strong></span>}
                    {stopTime && <span className='flex items-center gap-1'><Timer className="h-3 w-3 text-gray-400"/> Parada: <strong>{stopTime}</strong></span>}
                 </div>
                 {isCompleted && (
                   <div className="text-right text-sm text-muted-foreground">
                      <p>Chegada: {formatFirebaseTime(stop.arrivalTime)}</p>
                      <p>Saída: {formatFirebaseTime(stop.departureTime)}</p>
                   </div>
                 )}
              </div>
            )
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// --- Componente Aba Histórico ---
const HistoryDashboard = ({ fetchCompletedRuns, onViewRoute }: { fetchCompletedRuns: () => Promise<Run[]>, onViewRoute: (run: Run) => void }) => {
    const [allRuns, setAllRuns] = useState<Run[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [date, setDate] = useState<DateRange | undefined>({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    });

    useEffect(() => {
        setIsLoading(true);
        fetchCompletedRuns().then(data => {
            setAllRuns(data);
            setIsLoading(false);
        });
    }, [fetchCompletedRuns]);

    const filteredRuns = useMemo(() => {
        if (!date?.from) return allRuns;
        const toDate = date.to || date.from; // If no 'to' date, filter for a single day.
        return allRuns.filter(run => {
            if (!run.endTime?.seconds) return false;
            const runDate = new Date(run.endTime.seconds * 1000);
            return runDate >= startOfDay(date.from!) && runDate <= endOfDay(toDate);
        });
    }, [allRuns, date]);

    const kpis = useMemo(() => {
      const totalRuns = filteredRuns.length;
      const totalDistance = filteredRuns.reduce((acc, run) => {
        if (run.endMileage && run.startMileage) {
          return acc + (run.endMileage - run.startMileage);
        }
        return acc;
      }, 0);
      const totalDurationSeconds = filteredRuns.reduce((acc, run) => {
        if (run.endTime && run.startTime) {
          return acc + (run.endTime.seconds - run.startTime.seconds);
        }
        return acc;
      }, 0);
      const avgDurationMinutes = totalRuns > 0 ? (totalDurationSeconds / totalRuns / 60) : 0;
      
      return { totalRuns, totalDistance, avgDurationMinutes };
    }, [filteredRuns]);
    
    // Chart data is based on last 7 days regardless of filter, using all runs data
    const chartData = useMemo(() => {
        const last7Days = Array.from({ length: 7 }).map((_, i) => subDays(new Date(), i)).reverse();
        
        return last7Days.map(day => {
            const dayStart = startOfDay(day);
            const dayEnd = endOfDay(day);
            const runsOnDay = allRuns.filter(run => {
                if (!run.endTime?.seconds) return false;
                const endTime = new Date(run.endTime.seconds * 1000);
                return endTime >= dayStart && endTime <= dayEnd;
            });
            return {
                name: format(day, 'dd/MM'),
                total: runsOnDay.length,
            };
        });
    }, [allRuns]);


    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <h2 className="text-2xl font-bold">Análise de Desempenho</h2>
                <DateFilter date={date} setDate={setDate} />
            </div>
            
            {/* KPIs */}
            <div className="grid gap-4 md:grid-cols-3">
                <KpiCard title="Corridas Concluídas" value={kpis.totalRuns.toString()} />
                <KpiCard title="Distância Total Percorrida" value={`${kpis.totalDistance.toFixed(1)} km`} />
                <KpiCard title="Duração Média" value={`${kpis.avgDurationMinutes.toFixed(0)} min`} />
            </div>
            
            <div className="grid gap-6 lg:grid-cols-5">
                {/* Chart */}
                <Card className="lg:col-span-3">
                    <CardHeader>
                        <CardTitle>Corridas nos Últimos 7 Dias</CardTitle>
                        <CardDescription>Número de corridas concluídas por dia.</CardDescription>
                    </CardHeader>
                    <CardContent>
                    {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{backgroundColor: 'hsl(var(--background))'}}/>
                                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>}
                    </CardContent>
                </Card>

                {/* Runs Table */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Histórico Recente</CardTitle>
                        <CardDescription>Corridas concluídas no período selecionado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                    {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                        <div className="overflow-auto max-h-[300px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Motorista</TableHead>
                                        <TableHead>Veículo</TableHead>
                                        <TableHead className="text-right">Duração</TableHead>
                                        <TableHead className="text-right">Ação</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredRuns.length > 0 ? filteredRuns.map(run => <HistoryTableRow key={run.id} run={run} onViewRoute={() => onViewRoute(run)} />) : <TableRow><TableCell colSpan={4} className="text-center h-24">Nenhuma corrida encontrada</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </div>}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

// --- Componentes de Suporte ---

const KpiCard = ({ title, value }: { title: string, value: string }) => (
    <Card>
        <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const HistoryTableRow = ({ run, onViewRoute }: { run: Run, onViewRoute: () => void }) => {
    const duration = run.endTime && run.startTime ? Math.round((run.endTime.seconds - run.startTime.seconds) / 60) : 0;
    
    return (
        <TableRow>
            <TableCell>
                <div className="font-medium">{run.driverName}</div>
                <div className="text-xs text-muted-foreground">{run.endTime ? format(new Date(run.endTime.seconds * 1000), 'dd/MM/yy HH:mm') : ''}</div>
            </TableCell>
            <TableCell>{run.vehicleId}</TableCell>
            <TableCell className="text-right">{duration} min</TableCell>
            <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={onViewRoute}>
                  Ver Trajeto
                </Button>
            </TableCell>
        </TableRow>
    );
};

const DateFilter = ({ date, setDate }: { date: DateRange | undefined, setDate: (date: DateRange | undefined) => void }) => (
    <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className="w-full sm:w-[280px] justify-start text-left font-normal"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "dd/MM/y", { locale: ptBR })} -{" "}
                  {format(date.to, "dd/MM/y", { locale: ptBR })}
                </>
              ) : (
                format(date.from, "dd/MM/y", { locale: ptBR })
              )
            ) : (
              <span>Selecione um período</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
            locale={ptBR}
          />
        </PopoverContent>
    </Popover>
);

export default AdminDashboardPage;
