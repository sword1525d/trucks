'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, Clock, MapPin, Truck, User, LineChart, Calendar as CalendarIcon, Route } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import dynamic from 'next/dynamic';

const RealTimeMap = dynamic(() => import('./RealTimeMap'), { ssr: false });


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

type UserData = {
  name: string;
  isAdmin: boolean;
  companyId: string;
  sectorId: string;
};

const filterUniqueLocations = (locations: LocationPoint[]): LocationPoint[] => {
  if (!locations || locations.length === 0) return [];
  
  const uniqueLocations: LocationPoint[] = [locations[0]];
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i-1];
    const curr = locations[i];
    if (curr.latitude !== prev.latitude || curr.longitude !== prev.longitude) {
      uniqueLocations.push(curr);
    }
  }
  return uniqueLocations;
}

// --- Componente Principal ---
const AdminDashboardPage = () => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [user, setUser] = useState<UserData | null>(null);
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
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
  
  // Efeito para buscar dados em tempo real (corridas ativas)
  useEffect(() => {
    if (!firestore || !user) return;

    setIsLoading(true);
    const runsCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`);
    const activeRunsQuery = query(runsCol, where('status', '==', 'IN_PROGRESS'));

    const unsubscribe = onSnapshot(activeRunsQuery, (querySnapshot) => {
      const runs: Run[] = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
      setActiveRuns(runs.sort((a, b) => a.startTime.seconds - b.startTime.seconds));
      
      // Atualiza os dados do mapa se o modal estiver aberto
      setSelectedRunForMap(currentSelectedRun => {
        if (!currentSelectedRun) return null;
        const updatedRun = runs.find(run => run.id === currentSelectedRun.id);
        return updatedRun || null;
      });

      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching active runs: ", error);
      toast({ variant: 'destructive', title: 'Erro ao buscar dados', description: 'Não foi possível carregar os acompanhamentos ativos.' });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, user, toast]);

  // Função para buscar corridas completas (histórico)
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
        } catch (error: any) => {
            console.error("Error fetching completed runs: ", error);
            toast({ variant: 'destructive', title: 'Erro ao buscar histórico', description: 'Não foi possível carregar o histórico. Tente recarregar a página.' });
            return [];
        }
    }, [firestore, user, toast]);


  if (!user) {
     return <div className="flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-black">
      <Header />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto">
       <Tabs defaultValue="realtime" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-lg mx-auto mb-6">
          <TabsTrigger value="realtime"><PlayCircle className="mr-2"/> Em Tempo Real</TabsTrigger>
          <TabsTrigger value="history"><LineChart className="mr-2"/> Histórico e Análise</TabsTrigger>
        </TabsList>
        <TabsContent value="realtime">
            <RealTimeDashboard activeRuns={activeRuns} isLoading={isLoading} onSelectRun={setSelectedRunForMap} />
        </TabsContent>
        <TabsContent value="history">
            <HistoryDashboard fetchCompletedRuns={fetchCompletedRuns} onSelectRun={setSelectedRunForMap} />
        </TabsContent>
      </Tabs>
      </main>

       {selectedRunForMap && (
        <Dialog open={!!selectedRunForMap} onOpenChange={(isOpen) => !isOpen && setSelectedRunForMap(null)}>
          <DialogContent className="max-w-3xl h-[80vh]">
            <DialogHeader>
              <DialogTitle>Trajeto da Corrida - {selectedRunForMap.driverName}</DialogTitle>
            </DialogHeader>
            <div className="h-full w-full">
              <RealTimeMap locationHistory={selectedRunForMap.locationHistory || []} />
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
};

// --- Componente Header ---
const Header = () => {
    const [time, setTime] = useState(new Date());
     const router = useRouter();

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000 * 30);
        return () => clearInterval(timer);
    }, []);

    const handleLogout = () => {
        if (confirm('Tem certeza que deseja sair da conta?')) {
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
         <Button onClick={handleLogout} variant="outline">Sair</Button>
       </div>
      </header>
    );
};


// --- Componente Aba Tempo Real ---
const RealTimeDashboard = ({ activeRuns, isLoading, onSelectRun }: { activeRuns: Run[], isLoading: boolean, onSelectRun: (run: Run) => void }) => {
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
        {activeRuns.map(run => <RunAccordionItem key={run.id} run={run} onSelectRun={onSelectRun} />)}
      </Accordion>
  );
};

// --- Componente Item do Acordeão de Corrida ---
const RunAccordionItem = ({ run, onSelectRun }: { run: Run, onSelectRun: (run: Run) => void }) => {
  const completedStops = run.stops.filter(s => s.status === 'COMPLETED').length;
  const totalStops = run.stops.length;
  const progress = totalStops > 0 ? (completedStops / totalStops) * 100 : 0;
  const currentStop = run.stops.find(s => s.status === 'IN_PROGRESS');

  const formatTime = (timestamp: FirebaseTimestamp | null) => {
    if (!timestamp) return '--:--';
    return new Date(timestamp.seconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  
  const getStatusInfo = (status: StopStatus) => {
    switch (status) {
      case 'COMPLETED': return { icon: CheckCircle, color: 'text-green-500', label: 'Concluído' };
      case 'IN_PROGRESS': return { icon: PlayCircle, color: 'text-blue-500', label: 'Em Andamento' };
      case 'PENDING': return { icon: Clock, color: 'text-gray-500', label: 'Pendente' };
      default: return { icon: Clock, color: 'text-gray-500', label: 'Pendente' };
    }
  };

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
        <div className="space-y-2 mt-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">Pontos da Rota</h4>
             <Button variant="outline" size="sm" onClick={() => onSelectRun(run)} disabled={!run.locationHistory || run.locationHistory.length < 1}>
                <Route className="mr-2 h-4 w-4"/> Ver Trajeto
             </Button>
          </div>
          {run.stops.map((stop, index) => {
            const { icon: Icon, color, label } = getStatusInfo(stop.status);
            const isCompleted = stop.status === 'COMPLETED';
            return (
              <div key={index} className={`flex items-center gap-4 p-3 rounded-md ${isCompleted ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/20'}`}>
                 <Icon className={`h-5 w-5 flex-shrink-0 ${color}`} />
                 <div className="flex-1">
                   <p className="font-medium">{stop.name}</p>
                   <p className={`text-xs ${isCompleted ? 'text-muted-foreground' : color}`}>{label}</p>
                 </div>
                 {isCompleted && (
                   <div className="text-right text-sm text-muted-foreground">
                      <p>Chegada: {formatTime(stop.arrivalTime)}</p>
                      <p>Saída: {formatTime(stop.departureTime)}</p>
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
const HistoryDashboard = ({ fetchCompletedRuns, onSelectRun }: { fetchCompletedRuns: () => Promise<Run[]>, onSelectRun: (run: Run) => void }) => {
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
            return runDate >= startOfDay(date.from) && runDate <= endOfDay(toDate);
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
                                    {filteredRuns.length > 0 ? filteredRuns.map(run => <HistoryTableRow key={run.id} run={run} onSelectRun={onSelectRun} />) : <TableRow><TableCell colSpan={4} className="text-center h-24">Nenhuma corrida encontrada</TableCell></TableRow>}
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

const HistoryTableRow = ({ run, onSelectRun }: { run: Run, onSelectRun: (run: Run) => void }) => {
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
                <Button variant="outline" size="sm" onClick={() => onSelectRun(run)} disabled={!run.locationHistory || run.locationHistory.length < 2}>
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
