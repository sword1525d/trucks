'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useFirebase } from '@/firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';

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
import { ArrowLeft, CheckCircle2, Loader2, Milestone } from 'lucide-react';
import { OccupancySelector } from './OccupancySelector';


type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: any;
  departureTime: any;
  collectedOccupiedCars: number | null;
  collectedEmptyCars: number | null;
  mileageAtStop: number | null;
  occupancy: number | null;
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
  const [stopData, setStopData] = useState<{ occupied: string; empty: string; mileage: string, occupancy: number; }>({ occupied: '', empty: '', mileage: '', occupancy: 0 });
  
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
        const runData = runSnap.data() as Omit<Run, 'id'>;
        const transformedRunData: Run = { id: runSnap.id, ...runData };
        setRun(transformedRunData);
        
        const stop = transformedRunData.stops[0];
        if (stop && (stop.status === 'IN_PROGRESS' || stop.status === 'COMPLETED')) {
          setStopData({
            occupied: stop.collectedOccupiedCars?.toString() || '',
            empty: stop.collectedEmptyCars?.toString() || '',
            mileage: stop.mileageAtStop?.toString() || '',
            occupancy: stop.occupancy ?? 0
          });
        }
      } else {
        toast({ variant: 'destructive', title: 'Erro', description: 'Trajeto não encontrado.' });
        router.push('/dashboard-truck');
      }
    } catch (error) {
      console.error("Erro ao buscar trajeto:", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os dados do trajeto.' });
    } finally {
      setIsLoading(false);
    }
  }, [firestore, user, runId, router, toast]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

 const handleRegisterArrival = async () => {
    if (!run || !firestore || !runId || run.stops.length === 0) return;
    
    const stop = run.stops[0];
    if (stop.status !== 'PENDING') return;
    
    const arrivalTime = new Date();

    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);
      
      const updatedStops = [...run.stops];
      updatedStops[0].status = 'IN_PROGRESS';
      updatedStops[0].arrivalTime = arrivalTime;

      await updateDoc(runRef, {
        stops: updatedStops,
      });
      
      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = [...prevRun.stops];
          newStops[0] = { ...newStops[0], status: 'IN_PROGRESS', arrivalTime };
          return { ...prevRun, stops: newStops };
      });
      
      toast({ title: 'Chegada registrada!', description: `Você chegou em ${stop.name}.` });
    } catch (error) {
      console.error("Erro ao registrar chegada: ", error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível registrar a chegada.' });
    }
  };

  const handleFinishStop = async () => {
    if (!run || !firestore || !runId || run.stops.length === 0) return;
    
    const stop = run.stops[0];
    const { occupied, empty, mileage, occupancy } = stopData;

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

      const updatedStops = [...run.stops];
      updatedStops[0] = {
        ...updatedStops[0],
        status: 'COMPLETED',
        departureTime: departureTime,
        collectedOccupiedCars: finalOccupied,
        collectedEmptyCars: finalEmpty,
        mileageAtStop: finalMileage,
        occupancy: occupancy,
      };

      await updateDoc(runRef, {
        stops: updatedStops,
      });

      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = [...prevRun.stops];
          newStops[0] = {
              ...newStops[0],
              status: 'COMPLETED',
              departureTime,
              collectedOccupiedCars: finalOccupied,
              collectedEmptyCars: finalEmpty,
              mileageAtStop: finalMileage,
              occupancy,
          };
          return { ...prevRun, stops: newStops };
      });
      
      toast({ title: 'Parada finalizada!', description: `Parada em ${stop.name} concluída.` });
    } catch (error) {
       console.error("Erro ao finalizar parada: ", error);
       toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível finalizar a parada.' });
    }
  };

  const handleStopDataChange = (field: 'occupied' | 'empty' | 'mileage' | 'occupancy', value: string | number) => {
    setStopData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleFinishRun = async () => {
    if (!run || !firestore || !runId || run.stops.length === 0) return;
    
    const stop = run.stops[0];
    if (stop.status !== 'COMPLETED' || !stop.mileageAtStop) {
        toast({ variant: 'destructive', title: 'Erro', description: 'A quilometragem da parada finalizada é necessária para concluir a corrida.' });
        return;
    }

    try {
        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

        await updateDoc(runRef, {
            status: 'COMPLETED',
            endTime: new Date(),
            endMileage: stop.mileageAtStop
        });

        toast({ title: 'Trajeto Finalizado!', description: 'Sua rota foi concluída com sucesso.' });
        router.push('/dashboard-truck');

    } catch (error) {
        console.error("Erro ao finalizar trajeto: ", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível finalizar o trajeto.' });
    }
  }

  if (isLoading || !run || run.stops.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  const stop = run.stops[0];
  const stopNameIdentifier = stop.name.replace(/\s+/g, '-');
  const isPending = stop.status === 'PENDING';
  const isInProgress = stop.status === 'IN_PROGRESS';
  const isCompleted = stop.status === 'COMPLETED';

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" onClick={() => router.push('/dashboard-truck')}>
                <ArrowLeft />
            </Button>
            <div>
                <h1 className="text-2xl font-bold">Trajeto Ativo</h1>
                <p className="text-muted-foreground">Veículo: {run.vehicleId} | Motorista: {run.driverName}</p>
            </div>
        </div>

        <main className="space-y-4">
          <Card className={`group ${isCompleted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-card'}`}>
              <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                          {isCompleted ? <CheckCircle2 className="text-green-600"/> : <Milestone className="text-muted-foreground"/>}
                          {stop.name}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          isCompleted ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 
                          isInProgress ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      }`}>
                          {isCompleted ? 'CONCLUÍDO' : isInProgress ? 'EM ANDAMENTO' : 'PENDENTE'}
                      </span>
                  </CardTitle>
              </CardHeader>

              {isInProgress && (
                  <CardContent className="space-y-6 pt-0">
                     <OccupancySelector 
                          initialValue={stopData.occupancy}
                          onValueChange={(value) => handleStopDataChange('occupancy', value)}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1">
                              <Label htmlFor={`occupied-${stopNameIdentifier}`} className="text-sm">Carros ocupados</Label>
                              <Input id={`occupied-${stopNameIdentifier}`} type="number" placeholder="Qtd." 
                                  value={stopData.occupied}
                                  onChange={(e) => handleStopDataChange('occupied', e.target.value)}
                              />
                          </div>
                          <div className="space-y-1">
                              <Label htmlFor={`empty-${stopNameIdentifier}`} className="text-sm">Carros vazios</Label>
                              <Input id={`empty-${stopNameIdentifier}`} type="number" placeholder="Qtd." 
                                  value={stopData.empty}
                                  onChange={(e) => handleStopDataChange('empty', e.target.value)}
                              />
                          </div>
                          <div className="space-y-1">
                              <Label htmlFor={`mileage-${stopNameIdentifier}`} className="text-sm">Km atual</Label>
                              <Input id={`mileage-${stopNameIdentifier}`} type="number" placeholder="Quilometragem"
                                  value={stopData.mileage}
                                  onChange={(e) => handleStopDataChange('mileage', e.target.value)}
                              />
                          </div>
                      </div>
                  </CardContent>
              )}
              
              {isCompleted && (
                 <CardContent className="space-y-4 pt-0 text-sm text-muted-foreground">
                      <OccupancySelector initialValue={stop.occupancy ?? 0} disabled />
                      <div className="grid grid-cols-3 gap-4 border-t pt-4">
                          <p>Ocupados: <strong>{stop.collectedOccupiedCars}</strong></p>
                          <p>Vazios: <strong>{stop.collectedEmptyCars}</strong></p>
                          <p>KM: <strong>{stop.mileageAtStop}</strong></p>
                      </div>
                  </CardContent>
              )}

              <CardFooter>
              {isPending && (
                      <Button onClick={handleRegisterArrival}>
                          Registrar Chegada
                      </Button>
              )}
              {isInProgress && (
                      <Button onClick={handleFinishStop} variant="secondary" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800">
                          <CheckCircle2 className="mr-2 h-4 w-4"/> Finalizar Parada
                      </Button>
              )}
              </CardFooter>
          </Card>
            
          {isCompleted && (
              <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <CardHeader>
                      <CardTitle>Corrida Concluída!</CardTitle>
                      <CardDescription>A parada foi finalizada. Você pode encerrar o trajeto.</CardDescription>
                  </CardHeader>
                  <CardFooter>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button className="w-full sm:w-auto">Finalizar Trajeto</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader>
                                  <AlertDialogTitle>Confirmar finalização?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                      Ao confirmar, a rota será marcada como concluída e não poderá ser reaberta.
                                      A quilometragem da parada será salva como a quilometragem final.
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
