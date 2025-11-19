
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar as CalendarIcon, Route, Truck, User, Clock, CheckCircle, Car, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { format, subDays, startOfDay, endOfDay, formatDistanceStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import dynamic from 'next/dynamic';

// --- Tipos ---
type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

type FirebaseTimestamp = Timestamp;

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: FirebaseTimestamp | null;
  departureTime: FirebaseTimestamp | null;
  collectedOccupiedCars: number | null;
  collectedEmptyCars: number | null;
  mileageAtStop: number | null;
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
  status: 'COMPLETED';
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

const RealTimeMap = dynamic(() => import('../RealTimeMap'), {
  ssr: false,
  loading: () => <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
});

const HistoryPage = () => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const router = useRouter();

    const [user, setUser] = useState<UserData | null>(null);
    const [allRuns, setAllRuns] = useState<Run[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [date, setDate] = useState<DateRange | undefined>({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date()),
    });
    const [selectedRun, setSelectedRun] = useState<Run | null>(null);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        if (storedUser && companyId && sectorId) {
            setUser({ ...JSON.parse(storedUser), companyId, sectorId });
        } else {
            router.push('/login');
        }
    }, [router]);

    const fetchCompletedRuns = useCallback(async (): Promise<Run[]> => {
        if (!firestore || !user) return [];

        const runsQuery = query(
            collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`),
            where('status', '==', 'COMPLETED')
        );

        try {
            const querySnapshot = await getDocs(runsQuery);
            const runs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
            return runs.sort((a, b) => (b.endTime?.seconds || 0) - (a.endTime?.seconds || 0));
        } catch (error) {
            console.error("Error fetching completed runs: ", error);
            toast({ variant: 'destructive', title: 'Erro ao buscar histórico' });
            return [];
        }
    }, [firestore, user, toast]);

    useEffect(() => {
        if(user) {
            setIsLoading(true);
            fetchCompletedRuns().then(data => {
                setAllRuns(data);
                setIsLoading(false);
            });
        }
    }, [user, fetchCompletedRuns]);

    const filteredRuns = useMemo(() => {
        if (!date?.from) return allRuns;
        const toDate = date.to || date.from;
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
    
    const runsByDayChartData = useMemo(() => {
        if (!date || !date.from) return [];
        const from = startOfDay(date.from);
        const to = endOfDay(date.to || date.from);
        
        const dateMap = new Map<string, number>();

        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            dateMap.set(format(d, 'dd/MM'), 0);
        }

        filteredRuns.forEach(run => {
            if(run.endTime) {
                const day = format(new Date(run.endTime.seconds * 1000), 'dd/MM');
                if(dateMap.has(day)){
                    dateMap.set(day, (dateMap.get(day) || 0) + 1);
                }
            }
        });

        return Array.from(dateMap, ([name, total]) => ({ name, total }));
    }, [filteredRuns, date]);

    const distanceByVehicleChartData = useMemo(() => {
        const distanceMap = new Map<string, number>();

        filteredRuns.forEach(run => {
            if (run.endMileage && run.startMileage) {
                const distance = run.endMileage - run.startMileage;
                distanceMap.set(run.vehicleId, (distanceMap.get(run.vehicleId) || 0) + distance);
            }
        });
        
        return Array.from(distanceMap, ([vehicleId, distance]) => ({ name: vehicleId, total: Math.round(distance) }));
    }, [filteredRuns]);

    const handleViewDetails = (run: Run) => {
        setSelectedRun(run);
    };

    if (isLoading || !user) {
        return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    return (
        <div className="flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <h2 className="text-3xl font-bold tracking-tight">Histórico e Análise</h2>
                <DateFilter date={date} setDate={setDate} />
            </div>
            
            <div className="grid gap-4 md:grid-cols-3">
                <KpiCard title="Corridas Concluídas" value={kpis.totalRuns.toString()} />
                <KpiCard title="Distância Total" value={`${kpis.totalDistance.toFixed(1)} km`} />
                <KpiCard title="Duração Média" value={`${kpis.avgDurationMinutes.toFixed(0)} min`} />
            </div>
            
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Corridas por Dia</CardTitle>
                        <CardDescription>Total de corridas concluídas por dia no período selecionado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={runsByDayChartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}/>
                                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Km Rodados por Caminhão</CardTitle>
                        <CardDescription>Distância total percorrida por cada caminhão no período.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={distanceByVehicleChartData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis type="category" dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={80} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}} formatter={(value) => `${value} km`}/>
                                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>}
                    </CardContent>
                </Card>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle>Histórico de Corridas</CardTitle>
                    <CardDescription>Lista de corridas concluídas no período selecionado.</CardDescription>
                </CardHeader>
                <CardContent>
                {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                    <div className="overflow-auto max-h-[400px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Motorista</TableHead>
                                    <TableHead>Veículo</TableHead>
                                    <TableHead>Distância</TableHead>
                                    <TableHead>Data</TableHead>
                                    <TableHead className="text-right">Ação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredRuns.length > 0 ? filteredRuns.map(run => <HistoryTableRow key={run.id} run={run} onViewDetails={() => handleViewDetails(run)} />) : <TableRow><TableCell colSpan={5} className="text-center h-24">Nenhuma corrida encontrada</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </div>}
                </CardContent>
            </Card>

             <RunDetailsDialog run={selectedRun} isOpen={selectedRun !== null} onClose={() => setSelectedRun(null)} />
        </div>
    );
};

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

const HistoryTableRow = ({ run, onViewDetails }: { run: Run, onViewDetails: () => void }) => {
    const distance = run.endMileage && run.startMileage ? (run.endMileage - run.startMileage).toFixed(1) : 'N/A';
    return (
        <TableRow>
            <TableCell>
                <div className="font-medium flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> {run.driverName}</div>
            </TableCell>
            <TableCell><div className="flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground"/>{run.vehicleId}</div></TableCell>
            <TableCell>{distance} km</TableCell>
            <TableCell>{run.endTime ? format(new Date(run.endTime.seconds * 1000), 'dd/MM/yy HH:mm') : ''}</TableCell>
            <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={onViewDetails}>
                    <Route className="h-4 w-4 mr-2" />
                    Ver Detalhes
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

const RunDetailsDialog = ({ run, isOpen, onClose }: { run: Run | null, isOpen: boolean, onClose: () => void }) => {
    if (!run) return null;

    const formatFirebaseTime = (timestamp: FirebaseTimestamp | null) => {
        if (!timestamp) return '--:--';
        return format(new Date(timestamp.seconds * 1000), 'HH:mm');
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[80vh]">
                <DialogHeader>
                    <DialogTitle>Detalhes da Corrida - {run.driverName} ({run.vehicleId})</DialogTitle>
                    <DialogDescription>
                        Visualização detalhada da rota e paradas da corrida.
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="details" className="h-[calc(80vh-100px)]">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="details">Detalhes da Rota</TabsTrigger>
                        <TabsTrigger value="map">Mapa do Trajeto</TabsTrigger>
                    </TabsList>
                    <TabsContent value="details" className="h-[calc(100%-40px)] overflow-y-auto">
                        <div className="space-y-4 p-1">
                             {run.stops.filter(s => s.status === 'COMPLETED').map((stop, index) => (
                                <Card key={index} className="bg-muted/50">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <CheckCircle className="h-5 w-5 text-green-500" />
                                            {stop.name}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-muted-foreground" />
                                                <div>
                                                    <p className="font-semibold">Chegada: {formatFirebaseTime(stop.arrivalTime)}</p>
                                                    <p className="font-semibold">Saída: {formatFirebaseTime(stop.departureTime)}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Route className="h-4 w-4 text-muted-foreground" />
                                                <p className="font-semibold">KM: {stop.mileageAtStop || 'N/A'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Car className="h-4 w-4 text-muted-foreground" />
                                                <p className="font-semibold">Ocupados: {stop.collectedOccupiedCars ?? 'N/A'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Package className="h-4 w-4 text-muted-foreground" />
                                                <p className="font-semibold">Vazios: {stop.collectedEmptyCars ?? 'N/A'}</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </TabsContent>
                    <TabsContent value="map" className="h-[calc(100%-40px)] bg-muted rounded-md">
                        <RealTimeMap segments={[]} fullLocationHistory={run.locationHistory?.map(p => ({latitude: p.latitude, longitude: p.longitude})) || []} />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}

export default HistoryPage;

    