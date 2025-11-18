'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useFirebase } from '@/firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, Loader2, Milestone, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const PREDEFINED_STOP_POINTS: string[] = [
  "PINT. ABS", "PINT. FX ABS", "MOCOM", "INJ. PLÁSTICA", "PINT. PÓ", "USINAGEM", "PINT. TANQUE", "PINT. ALUMÍNIO",
  "MONT. RODA", "SOLDA CHASSI", "DIV. PEÇAS", "GALVANOPLASTIA", "DOBRADETUBOS", "ESTAM. PRENSA", "MONT. MOTOR", "SOLDA ESCAP.",
  "LINHA MONT.", "PINT. ALT. TEMP.", "SOLDA TANQUE", "FUNDIÇÃO", "SOLDA COMP.", "FÁBR. ASSENTO", "MONT. QUADRI.", "MONT. FILTRO",
  "SOLDA ALUMÍNIO", "FABRICA DE ARO", "MOCOMMSIN1", "PRENSA. COMP."
];

type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: any;
  departureTime: any;
  collectedOccupiedCars: number | null;
  collectedEmptyCars: number | null;
  mileageAtStop: number | null;
};

type LocationPoint = {
  latitude: number;
  longitude: number;
  timestamp: any;
}

type Run = {
  id: string;
  driverName: string;
  vehicleId: string;
  startMileage: number;
  startTime: any;
  status: 'IN_PROGRESS' | 'COMPLETED';
  stops: Stop[];
  endTime: any;
  endMileage: number | null;
  locationHistory?: LocationPoint[];
};

// Custom hook for location tracking
const useLocationTracking = (runId: string | null, isActive: boolean) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!runId || !isActive || !firestore) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');

    if (!companyId || !sectorId) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Informações de empresa/setor não encontradas.' });
      return;
    }

    const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      const newLocation: LocationPoint = {
        latitude,
        longitude,
        timestamp: new Date(), // Using client time for location timestamp
      };

      updateDoc(runRef, {
        locationHistory: arrayUnion(newLocation)
      }).catch(error => {
        console.error("Erro ao salvar localização: ", error);
        // Don't toast every time, could be overwhelming
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      console.error("Erro de geolocalização: ", error);
      toast({ variant: 'destructive', title: 'Erro de Localização', description: `Não foi possível obter sua localização: ${error.message}` });
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 1000,
      });
    } else {
      toast({ variant: 'destructive', title: 'Erro', description: 'Geolocalização não é suportada neste navegador.' });
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [runId, isActive, firestore, toast]);
};


function ActiveRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [run, setRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stopData, setStopData] = useState<{ [key: string]: { occupied: string; empty: string; mileage: string } }>({});
  const [newPoint, setNewPoint] = useState('');
  
  const runId = searchParams.get('id');

  // Activate location tracking
  useLocationTracking(runId, run?.status === 'IN_PROGRESS');

  const fetchRun = useCallback(async () => {
    if (!firestore || !user || !runId) return;
    setIsLoading(true);
    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      if (!companyId || !sectorId) {
        throw new Error('Informações de empresa/setor não encontradas.');
      }
      
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);
      const runSnap = await getDoc(runRef);

      if (runSnap.exists()) {
        const runData = runSnap.data();
        const stopsArray = Array.isArray(runData.stops) ? runData.stops : [];
        const transformedRunData = { id: runSnap.id, ...runData, stops: stopsArray } as Run;
        setRun(transformedRunData);
        
        const initialStopData: typeof stopData = {};
        if (Array.isArray(transformedRunData.stops)) {
            transformedRunData.stops.forEach(stop => {
              if (stop.status === 'IN_PROGRESS' || stop.status === 'COMPLETED') {
                initialStopData[stop.name] = {
                  occupied: stop.collectedOccupiedCars?.toString() || '',
                  empty: stop.collectedEmptyCars?.toString() || '',
                  mileage: stop.mileageAtStop?.toString() || '',
                }
              }
            });
        }
        setStopData(initialStopData);
      } else {
        toast({ variant: 'destructive', title: 'Erro', description: 'Acompanhamento não encontrado.' });
        router.push('/dashboard-truck');
      }
    } catch (error) {
      console.error("Erro ao buscar acompanhamento:", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os dados do acompanhamento.' });
    } finally {
      setIsLoading(false);
    }
  }, [firestore, user, runId, router, toast]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

 const handleRegisterArrival = async (stopIndex: number) => {
    if (!run || !firestore || !runId) return;
    
    const stopsArray = Array.isArray(run.stops) ? run.stops : [];
    if (stopsArray.length === 0 || stopsArray[stopIndex].status !== 'PENDING') return;
    
    const arrivalTime = new Date();

    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);
      
      const updatedStops = [...stopsArray];
      updatedStops[stopIndex].status = 'IN_PROGRESS';
      updatedStops[stopIndex].arrivalTime = arrivalTime;

      await updateDoc(runRef, {
        stops: updatedStops,
      });
      
      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = prevRun.stops.map((stop, index) => {
              if (index === stopIndex) {
                  return { ...stop, status: 'IN_PROGRESS' as StopStatus, arrivalTime: arrivalTime };
              }
              return stop;
          });
          return { ...prevRun, stops: newStops };
      });
      
      toast({ title: 'Chegada registrada!', description: `Você chegou em ${stopsArray[stopIndex].name}.` });
    } catch (error) {
      console.error("Erro ao registrar chegada: ", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível registrar a chegada.' });
    }
  };

  const handleFinishStop = async (stopIndex: number) => {
    if (!run || !firestore || !runId) return;
    
    const stopsArray = Array.isArray(run.stops) ? run.stops : [];
    if(stopsArray.length === 0) return;

    const stopName = stopsArray[stopIndex].name;
    const currentStopData = stopData[stopName] || { occupied: '', empty: '', mileage: '' };
    const { occupied, empty, mileage } = currentStopData;

    if (!occupied || !empty || !mileage) {
      toast({ variant: 'destructive', title: 'Campos obrigatórios', description: 'Preencha todos os campos para finalizar a parada.' });
      return;
    }
    
    const departureTime = new Date();

    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

      const finalOccupied = Number(occupied);
      const finalEmpty = Number(empty);
      const finalMileage = Number(mileage);

      const updatedStops = [...stopsArray];
      updatedStops[stopIndex] = {
        ...updatedStops[stopIndex],
        status: 'COMPLETED',
        departureTime: departureTime,
        collectedOccupiedCars: finalOccupied,
        collectedEmptyCars: finalEmpty,
        mileageAtStop: finalMileage,
      };

      await updateDoc(runRef, {
        stops: updatedStops,
      });

      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = prevRun.stops.map((stop, index) => {
            if (index === stopIndex) {
                return {
                    ...stop,
                    status: 'COMPLETED' as StopStatus,
                    departureTime: departureTime,
                    collectedOccupiedCars: finalOccupied,
                    collectedEmptyCars: finalEmpty,
                    mileageAtStop: finalMileage,
                };
            }
            return stop;
          });
          return { ...prevRun, stops: newStops };
      });
      
      toast({ title: 'Parada finalizada!', description: `Parada em ${stopName} concluída.` });
    } catch (error) {
       console.error("Erro ao finalizar parada: ", error);
       toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível finalizar a parada.' });
    }
  };

  const handleStopDataChange = (stopName: string, field: 'occupied' | 'empty' | 'mileage', value: string) => {
    setStopData(prev => ({
        ...prev,
        [stopName]: {
            ...(prev[stopName] || { occupied: '', empty: '', mileage: '' }),
            [field]: value
        }
    }));
  };

  const updateStopsInFirestore = async (newStops: Stop[]) => {
    if (!run || !firestore || !runId) return;

    try {
        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

        await updateDoc(runRef, { stops: newStops });

        setRun(prevRun => prevRun ? { ...prevRun, stops: newStops } : null);
    } catch (error) {
        console.error("Erro ao atualizar paradas:", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível atualizar a lista de paradas.' });
        fetchRun(); // Re-fetch para reverter
    }
  };

  const handleAddPoint = () => {
    if (!run) return;
    if (newPoint && !run.stops.some(s => s.name === newPoint)) {
      const newStop: Stop = {
        name: newPoint,
        status: 'PENDING',
        arrivalTime: null,
        departureTime: null,
        collectedOccupiedCars: null,
        collectedEmptyCars: null,
        mileageAtStop: null,
      };
      const newStops = [...run.stops, newStop];
      updateStopsInFirestore(newStops);
      setNewPoint('');
      toast({ description: `Ponto "${newPoint}" adicionado.` });
    } else {
        toast({ variant: 'destructive', description: 'Selecione um ponto ou o ponto já foi adicionado.' });
    }
  };

  const handleCancelPoint = (indexToRemove: number) => {
    if (!run) return;
    const newStops = run.stops.filter((_, index) => index !== indexToRemove);
    updateStopsInFirestore(newStops);
    toast({ variant: 'destructive', description: 'Ponto removido.' });
  };
  
  const handleMovePoint = (index: number, direction: 'up' | 'down') => {
    if (!run) return;
    const newStops = [...run.stops];
    if (direction === 'up' && index > 0) {
      [newStops[index - 1], newStops[index]] = [newStops[index], newStops[index - 1]];
      updateStopsInFirestore(newStops);
    } else if (direction === 'down' && index < newStops.length - 1) {
      [newStops[index + 1], newStops[index]] = [newStops[index], newStops[index + 1]];
      updateStopsInFirestore(newStops);
    }
  };
  
  const handleFinishRun = async () => {
    if (!run || !firestore || !runId) return;
    
    const stopsArray = Array.isArray(run.stops) ? run.stops : [];
    // Get the last COMPLETED stop, not just the last one in the array
    const lastCompletedStop = [...stopsArray].reverse().find(s => s.status === 'COMPLETED');


    if (!lastCompletedStop || !lastCompletedStop.mileageAtStop) {
        toast({ variant: 'destructive', title: 'Erro', description: 'A quilometragem da última parada finalizada é necessária para concluir a corrida.' });
        return;
    }

    try {
        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

        await updateDoc(runRef, {
            status: 'COMPLETED',
            endTime: new Date(),
            endMileage: lastCompletedStop.mileageAtStop
        });

        toast({ title: 'Acompanhamento Finalizado!', description: 'Sua rota foi concluída com sucesso.' });
        router.push('/dashboard-truck');

    } catch (error) {
        console.error("Erro ao finalizar acompanhamento: ", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível finalizar o acompanhamento.' });
    }
  }

  const allStopsCompleted = run && Array.isArray(run.stops) && run.stops.length > 0 && run.stops.every(s => s.status === 'COMPLETED' || s.status === 'CANCELED');


  if (isLoading || !run) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  const stopsArray = Array.isArray(run.stops) ? run.stops : [];

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => router.push('/dashboard-truck')}>
                <ArrowLeft />
            </Button>
            <div>
                <h1 className="text-2xl font-bold">Acompanhamento Ativo</h1>
                <p className="text-muted-foreground">Veículo: {run.vehicleId} | Motorista: {run.driverName}</p>
            </div>
        </div>

        <main className="space-y-4">
            {stopsArray.map((stop, index) => {
                const stopNameIdentifier = stop.name.replace(/\s+/g, '-');
                const isPending = stop.status === 'PENDING';
                const isInProgress = stop.status === 'IN_PROGRESS';
                const isCompleted = stop.status === 'COMPLETED';
                const isCanceled = stop.status === 'CANCELED';
                
                const canStartThisStop = isPending && (index === 0 || (stopsArray[index-1] && stopsArray[index-1].status === 'COMPLETED'));
                
                if (isCanceled) return null;

                return (
                    <Card key={index} className={`group ${isCompleted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-card'}`}>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    {isCompleted ? <CheckCircle2 className="text-green-600"/> : <Milestone className="text-muted-foreground"/>}
                                    {stop.name}
                                </span>
                                <div className="flex items-center gap-1">
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMovePoint(index, 'up')} disabled={index === 0}>
                                          <ArrowUp className="h-4 w-4"/>
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMovePoint(index, 'down')} disabled={index === stopsArray.length - 1}>
                                          <ArrowDown className="h-4 w-4"/>
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCancelPoint(index)}>
                                          <Trash2 className="text-destructive h-4 w-4"/>
                                      </Button>
                                    </div>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                        isCompleted ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                                        isInProgress ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' :
                                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                                    }`}>
                                        {isCompleted ? 'CONCLUÍDO' : isInProgress ? 'EM ANDAMENTO' : 'PENDENTE'}
                                    </span>
                                </div>
                            </CardTitle>
                        </CardHeader>

                        {isInProgress && (
                            <CardContent className="space-y-4 pt-0">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="space-y-1">
                                        <Label htmlFor={`occupied-${stopNameIdentifier}`} className="text-sm">Carros ocupados</Label>
                                        <Input id={`occupied-${stopNameIdentifier}`} type="number" placeholder="Qtd." 
                                            value={stopData[stop.name]?.occupied || ''}
                                            onChange={(e) => handleStopDataChange(stop.name, 'occupied', e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={`empty-${stopNameIdentifier}`} className="text-sm">Carros vazios</Label>
                                        <Input id={`empty-${stopNameIdentifier}`} type="number" placeholder="Qtd." 
                                            value={stopData[stop.name]?.empty || ''}
                                            onChange={(e) => handleStopDataChange(stop.name, 'empty', e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={`mileage-${stopNameIdentifier}`} className="text-sm">Km atual</Label>
                                        <Input id={`mileage-${stopNameIdentifier}`} type="number" placeholder="Quilometragem"
                                            value={stopData[stop.name]?.mileage || ''}
                                            onChange={(e) => handleStopDataChange(stop.name, 'mileage', e.target.value)}
                                        />
                                    </div>
                            </div>
                            </CardContent>
                        )}
                        
                        {isCompleted && (
                            <CardContent className="space-y-2 pt-0 text-sm text-muted-foreground">
                                <p>Carros ocupados: <strong>{stop.collectedOccupiedCars}</strong></p>
                                <p>Carros vazios: <strong>{stop.collectedEmptyCars}</strong></p>
                                <p>KM na Parada: <strong>{stop.mileageAtStop}</strong></p>
                            </CardContent>
                        )}

                        <CardFooter>
                        {isPending && (
                                <Button onClick={() => handleRegisterArrival(index)} disabled={!canStartThisStop}>
                                    Registrar Chegada
                                </Button>
                        )}
                        {isInProgress && (
                                <Button onClick={() => handleFinishStop(index)} variant="secondary" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800">
                                    <CheckCircle2 className="mr-2 h-4 w-4"/> Finalizar Parada
                                </Button>
                        )}
                        </CardFooter>
                    </Card>
                )
            })}
             <Separator />

              <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold">Adicionar Parada à Rota</h3>
                <div className="flex gap-2">
                    <Select value={newPoint} onValueChange={setNewPoint}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecione um novo ponto" />
                        </SelectTrigger>
                        <SelectContent>
                            {PREDEFINED_STOP_POINTS.filter(p => !stopsArray.some(s => s.name === p)).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleAddPoint}><Plus className="mr-2 h-4 w-4"/> Adicionar</Button>
                </div>
              </div>
            
            {allStopsCompleted && (
                <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                    <CardHeader>
                        <CardTitle>Rota Concluída!</CardTitle>
                        <CardDescription>Todos os pontos de parada foram finalizados. Você pode finalizar o acompanhamento.</CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className="w-full sm:w-auto">Finalizar Acompanhamento</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirmar finalização?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Ao confirmar, a rota será marcada como concluída e não poderá ser reaberta.
                                        A quilometragem da última parada será salva como a quilometragem final.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleFinishRun}>Confirmar e Finalizar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardFooter>
                </Card>
            )}
        </main>
    </div>
  );
}

export default function ActiveRunPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin"/></div>}>
            <ActiveRunContent />
        </Suspense>
    )
}
