
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar as CalendarIcon, Route, Truck, User, Clock, CheckCircle, Car, Package, Warehouse, Milestone } from 'lucide-react';
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

// --- Constantes ---
const TURNOS = {
    TODOS: 'Todos',
    PRIMEIRO_NORMAL: '1° NORMAL',
    SEGUNDO_NORMAL: '2° NORMAL',
    PRIMEIRO_ESPECIAL: '1° ESPECIAL',
    SEGUNDO_ESPECIAL: '2° ESPECIAL'
};

const SEGMENT_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f97316', '#8b5cf6', '#ec4899', 
    '#6366f1', '#f59e0b', '#14b8a6', '#d946ef'
];

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
  occupancy: number | null;
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
  startMileage: number;
  endMileage: number | null;
  startTime: FirebaseTimestamp;
  endTime: FirebaseTimestamp | null;
  status: 'COMPLETED';
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
    totalDuration: number; // in seconds
    stops: Stop[];
    locationHistory: LocationPoint[];
    originalRuns: Run[];
    startMileage: number;
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

const formatTimeDiff = (start: Date, end: Date) => {
    if (!start || !end) return 'N/A';
    return formatDistanceStrict(end, start, { locale: ptBR, unit: 'minute' });
}

const processRunSegments = (run: AggregatedRun): Segment[] => {
    if (!run.locationHistory || run.locationHistory.length === 0) return [];
    
    const sortedLocations = [...run.locationHistory].sort((a,b) => a.timestamp.seconds - b.timestamp.seconds);
    const sortedStops = [...run.stops].filter(s => s.status === 'COMPLETED').sort((a, b) => (a.arrivalTime?.seconds || 0) - (b.arrivalTime?.seconds || 0));

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
        
        segments.push({
            label: `Trajeto para ${stop.name}`,
            path: segmentPath,
            color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            travelTime: formatTimeDiff(new Date(lastDepartureTime.seconds * 1000), stopArrivalTime),
            stopTime: stopDepartureTime ? formatTimeDiff(stopArrivalTime, stopDepartureTime) : 'Em andamento',
            distance: segmentDistance !== null ? `${segmentDistance.toFixed(1)} km` : 'N/A'
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

const HistoryPage = () => {
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const router = useRouter();

    const [user, setUser] = useState<UserData | null>(null);
    const [allRuns, setAllRuns] = useState<Run[]>([]);
    const [users, setUsers] = useState<Map<string, FirestoreUser>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [selectedShift, setSelectedShift] = useState<string>(TURNOS.TODOS);
    const [date, setDate] = useState<DateRange | undefined>({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date()),
    });
    const [selectedRun, setSelectedRun] = useState<AggregatedRun | null>(null);

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

    const fetchInitialData = useCallback(async () => {
        if (!firestore || !user) return;
        setIsLoading(true);

        try {
            // Fetch Users
            const usersCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/users`);
            const usersSnapshot = await getDocs(usersCol);
            const usersMap = new Map<string, FirestoreUser>();
            usersSnapshot.forEach(doc => {
                usersMap.set(doc.id, { id: doc.id, ...doc.data() } as FirestoreUser);
            });
            setUsers(usersMap);

            // Fetch Completed Runs
            const runsQuery = query(
                collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`),
                where('status', '==', 'COMPLETED')
            );
            const querySnapshot = await getDocs(runsQuery);
            const runs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Run));
            setAllRuns(runs.sort((a, b) => (b.endTime?.seconds || 0) - (a.endTime?.seconds || 0)));

        } catch (error) {
            console.error("Error fetching data: ", error);
            toast({ variant: 'destructive', title: 'Erro ao buscar dados' });
        } finally {
            setIsLoading(false);
        }
    }, [firestore, user, toast]);

    useEffect(() => {
        if(user) {
            fetchInitialData();
        }
    }, [user, fetchInitialData]);

    const aggregatedRuns = useMemo(() => {
        const filtered = allRuns.filter(run => {
            const runDate = run.endTime ? new Date(run.endTime.seconds * 1000) : null;
            if (!runDate) return false;

            const isWithinDateRange = date?.from && runDate >= startOfDay(date.from) && runDate <= endOfDay(date.to || date.from);
            if (!isWithinDateRange) return false;
            
            const driver = users.get(run.driverId);
            if (selectedShift !== TURNOS.TODOS && driver?.shift !== selectedShift) return false;

            return true;
        });

        const groupedRuns = new Map<string, Run[]>();
        filtered.forEach(run => {
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

            const allStops = runs.flatMap(r => r.stops).filter(s => s.status === 'COMPLETED').sort((a,b) => (a.arrivalTime?.seconds || 0) - (b.arrivalTime?.seconds || 0));
            const allLocations = runs.flatMap(r => r.locationHistory || []).sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);
            
            const startMileage = firstRun.startMileage;
            const endMileage = lastRun.endMileage;
            const totalDistance = (endMileage && startMileage) ? endMileage - startMileage : 0;

            const totalDuration = lastRun.endTime ? lastRun.endTime.seconds - firstRun.startTime.seconds : 0;

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
                totalDuration: totalDuration,
                stops: allStops,
                locationHistory: allLocations,
                originalRuns: runs,
                startMileage: startMileage
            });
        });
        
        return aggregated.sort((a, b) => b.startTime.seconds - a.startTime.seconds);
    }, [allRuns, date, selectedShift, users]);

    const kpis = useMemo(() => {
      const totalRuns = aggregatedRuns.length;
      const totalDistance = aggregatedRuns.reduce((acc, run) => acc + run.totalDistance, 0);
      const totalDurationSeconds = aggregatedRuns.reduce((acc, run) => acc + run.totalDuration, 0);
      const avgDurationMinutes = totalRuns > 0 ? (totalDurationSeconds / totalRuns / 60) : 0;
      const totalStops = aggregatedRuns.reduce((acc, run) => acc + run.stops.length, 0);
      
      return { totalRuns, totalDistance, avgDurationMinutes, totalStops };
    }, [aggregatedRuns]);
    
    const runsByDayChartData = useMemo(() => {
        if (!date || !date.from) return [];
        const from = startOfDay(date.from);
        const to = endOfDay(date.to || date.from);
        
        const dateMap = new Map<string, number>();

        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            dateMap.set(format(d, 'dd/MM'), 0);
        }

        aggregatedRuns.forEach(run => {
            const day = format(new Date(run.startTime.seconds * 1000), 'dd/MM');
            if(dateMap.has(day)){
                dateMap.set(day, (dateMap.get(day) || 0) + 1);
            }
        });

        return Array.from(dateMap, ([name, total]) => ({ name, total }));
    }, [aggregatedRuns, date]);

    const distanceByVehicleChartData = useMemo(() => {
        const distanceMap = new Map<string, number>();

        aggregatedRuns.forEach(run => {
            distanceMap.set(run.vehicleId, (distanceMap.get(run.vehicleId) || 0) + run.totalDistance);
        });
        
        return Array.from(distanceMap, ([vehicleId, distance]) => ({ name: vehicleId, total: Math.round(distance) }));
    }, [aggregatedRuns]);

    const handleViewDetails = (run: AggregatedRun) => {
        setSelectedRun(run);
    };

    if (isLoading || !user) {
        return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    return (
        <div className="flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <h2 className="text-3xl font-bold tracking-tight">Histórico e Análise</h2>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <ShiftFilter selectedShift={selectedShift} onShiftChange={setSelectedShift} />
                    <DateFilter date={date} setDate={setDate} />
                </div>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard title="Rotas Concluídas" value={kpis.totalRuns.toString()} />
                <KpiCard title="Paradas Totais" value={kpis.totalStops.toString()} />
                <KpiCard title="Distância Total" value={`${kpis.totalDistance.toFixed(1)} km`} />
                <KpiCard title="Duração Média da Rota" value={`${kpis.avgDurationMinutes.toFixed(0)} min`} />
            </div>
            
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Rotas por Dia</CardTitle>
                        <CardDescription>Total de rotas concluídas por dia no período e turno selecionados.</CardDescription>
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
                        <CardDescription>Distância total percorrida por cada caminhão no período e turno.</CardDescription>
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
                    <CardTitle>Histórico de Rotas</CardTitle>
                    <CardDescription>Lista de rotas concluídas no período e turno selecionados.</CardDescription>
                </CardHeader>
                <CardContent>
                {isLoading ? <div className="flex justify-center items-center h-[300px]"><Loader2 className="w-8 h-8 animate-spin"/></div> :
                    <div className="overflow-auto max-h-[400px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Motorista</TableHead>
                                    <TableHead>Veículo</TableHead>
                                    <TableHead>Turno</TableHead>
                                    <TableHead>Paradas</TableHead>
                                    <TableHead>Distância</TableHead>
                                    <TableHead>Data</TableHead>
                                    <TableHead className="text-right">Ação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {aggregatedRuns.length > 0 ? aggregatedRuns.map(run => <HistoryTableRow key={run.key} run={run} onViewDetails={() => handleViewDetails(run)} />) : <TableRow><TableCell colSpan={7} className="text-center h-24">Nenhuma rota encontrada</TableCell></TableRow>}
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

const HistoryTableRow = ({ run, onViewDetails }: { run: AggregatedRun, onViewDetails: () => void }) => {
    return (
        <TableRow>
            <TableCell>
                <div className="font-medium flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> {run.driverName}</div>
            </TableCell>
            <TableCell><div className="flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground"/>{run.vehicleId}</div></TableCell>
            <TableCell>{run.shift}</TableCell>
            <TableCell>{run.stops.length}</TableCell>
            <TableCell>{run.totalDistance.toFixed(1)} km</TableCell>
            <TableCell>{run.date}</TableCell>
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

const ShiftFilter = ({ selectedShift, onShiftChange }: { selectedShift: string, onShiftChange: (shift: string) => void }) => (
    <Select value={selectedShift} onValueChange={onShiftChange}>
        <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filtrar por turno" />
        </SelectTrigger>
        <SelectContent>
            {Object.values(TURNOS).map(turno => (
                <SelectItem key={turno} value={turno}>{turno}</SelectItem>
            ))}
        </SelectContent>
    </Select>
);


const RunDetailsDialog = ({ run, isOpen, onClose }: { run: AggregatedRun | null, isOpen: boolean, onClose: () => void }) => {
    if (!run) return null;

    const formatFirebaseTime = (timestamp: FirebaseTimestamp | null) => {
        if (!timestamp) return '--:--';
        return format(new Date(timestamp.seconds * 1000), 'HH:mm');
    };
    
    const mapSegments = processRunSegments(run);
    const fullLocationHistory = run.locationHistory?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || [];
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[80vh]">
                <DialogHeader>
                    <DialogTitle>Detalhes da Rota - {run.driverName} ({run.vehicleId})</DialogTitle>
                    <DialogDescription>
                        Visualização detalhada da rota e paradas da corrida de {run.date} ({run.shift}).
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="details" className="h-[calc(80vh-100px)]">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="details">Detalhes da Rota</TabsTrigger>
                        <TabsTrigger value="map">Mapa do Trajeto</TabsTrigger>
                    </TabsList>
                    <TabsContent value="details" className="h-[calc(100%-40px)] overflow-y-auto">
                        <div className="space-y-4 p-1">
                             {run.stops.filter(s => s.status === 'COMPLETED').map((stop, index) => {
                                const previousStop = index > 0 ? run.stops[index - 1] : null;
                                const segmentStartTime = previousStop ? previousStop.departureTime : run.startTime;
                                
                                const startMileage = previousStop?.mileageAtStop ?? run.startMileage;
                                const segmentDistance = stop.mileageAtStop ? stop.mileageAtStop - startMileage : null;

                                return (
                                    <Card key={index} className="bg-muted/50">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <Milestone className="h-5 w-5 text-muted-foreground" />
                                                {stop.name}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                                    <div>
                                                        <p className="font-semibold">Início: {formatFirebaseTime(segmentStartTime)}</p>
                                                        <p className="font-semibold">Fim: {formatFirebaseTime(stop.arrivalTime)}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Route className="h-4 w-4 text-muted-foreground" />
                                                    <p className="font-semibold">KM: {segmentDistance !== null ? `${segmentDistance.toFixed(1)}` : 'N/A'}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Car className="h-4 w-4 text-muted-foreground" />
                                                    <p className="font-semibold">Ocupados: {stop.collectedOccupiedCars ?? 'N/A'}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-muted-foreground" />
                                                    <p className="font-semibold">Vazios: {stop.collectedEmptyCars ?? 'N/A'}</p>
                                                </div>
                                                 <div className="flex items-center gap-2">
                                                    <Warehouse className="h-4 w-4 text-muted-foreground" />
                                                    <p className="font-semibold">Ocupação: {stop.occupancy ?? 'N/A'}%</p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    </TabsContent>
                    <TabsContent value="map" className="h-[calc(100%-40px)] bg-muted rounded-md">
                        <RealTimeMap 
                            segments={mapSegments} 
                            fullLocationHistory={fullLocationHistory} 
                            vehicleId={run.vehicleId}
                        />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}

export default HistoryPage;
