'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useFirebase } from '@/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

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
import { ArrowLeft, CheckCircle2, Loader2, Milestone, Truck } from 'lucide-react';

type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

type Stop = {
  name: string;
  status: StopStatus;
  arrivalTime: any;
  departureTime: any;
  collectedOccupiedCars: number | null;
  collectedEmptyCars: number | null;
  mileageAtStop: number | null;
};

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
};

function ActiveRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [run, setRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stopData, setStopData] = useState<{ [key: string]: { occupied: string; empty: string; mileage: string } }>({});
  
  const runId = searchParams.get('id');

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
        // Ensure runData.stops is always an array
        const stopsArray = Array.isArray(runData.stops) ? runData.stops : [];
        const transformedRunData = { id: runSnap.id, ...runData, stops: stopsArray } as Run;
        setRun(transformedRunData);
        
        // Pre-fill stop data if run is reloaded
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

    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);
      
      const updatedStops = [...stopsArray];
      updatedStops[stopIndex].status = 'IN_PROGRESS';
      updatedStops[stopIndex].arrivalTime = serverTimestamp();

      await updateDoc(runRef, {
        stops: updatedStops,
      });
      
      const localArrivalTime = new Date();
      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = Array.isArray(prevRun.stops) ? [...prevRun.stops] : [];
          if (newStops[stopIndex]) {
            newStops[stopIndex] = { ...newStops[stopIndex], status: 'IN_PROGRESS', arrivalTime: localArrivalTime };
          }
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
    
    try {
      const companyId = localStorage.getItem('companyId');
      const sectorId = localStorage.getItem('sectorId');
      const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

      const updatedStops = [...stopsArray];
      const finalOccupied = Number(occupied);
      const finalEmpty = Number(empty);
      const finalMileage = Number(mileage);

      updatedStops[stopIndex] = {
        ...updatedStops[stopIndex],
        status: 'COMPLETED',
        departureTime: serverTimestamp(),
        collectedOccupiedCars: finalOccupied,
        collectedEmptyCars: finalEmpty,
        mileageAtStop: finalMileage,
      };

      await updateDoc(runRef, {
        stops: updatedStops,
      });

      const localDepartureTime = new Date();
      setRun(prevRun => {
          if (!prevRun) return null;
          const newStops = Array.isArray(prevRun.stops) ? [...prevRun.stops] : [];
          if(newStops[stopIndex]) {
            newStops[stopIndex] = { 
                ...newStops[stopIndex], 
                status: 'COMPLETED', 
                departureTime: localDepartureTime,
                collectedOccupiedCars: finalOccupied,
                collectedEmptyCars: finalEmpty,
                mileageAtStop: finalMileage
            };
          }
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
  
  const handleFinishRun = async () => {
    if (!run || !firestore || !runId) return;
    
    const stopsArray = Array.isArray(run.stops) ? run.stops : [];
    const lastStop = stopsArray.length > 0 ? stopsArray[stopsArray.length - 1] : null;

    if (!lastStop || !lastStop.mileageAtStop) {
        toast({ variant: 'destructive', title: 'Erro', description: 'A quilometragem da última parada é necessária.' });
        return;
    }

    try {
        const companyId = localStorage.getItem('companyId');
        const sectorId = localStorage.getItem('sectorId');
        const runRef = doc(firestore, `companies/${companyId}/sectors/${sectorId}/runs`, runId);

        await updateDoc(runRef, {
            status: 'COMPLETED',
            endTime: serverTimestamp(),
            endMileage: lastStop.mileageAtStop
        });

        toast({ title: 'Acompanhamento Finalizado!', description: 'Sua rota foi concluída com sucesso.' });
        router.push('/dashboard-truck');

    } catch (error) {
        console.error("Erro ao finalizar acompanhamento: ", error);
        toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível finalizar o acompanhamento.' });
    }
  }

  const allStopsCompleted = run && Array.isArray(run.stops) && run.stops.length > 0 && run.stops.every(s => s.status === 'COMPLETED');


  if (isLoading || !run) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  const stopsArray = Array.isArray(run.stops) ? run.stops : [];

  return (
    <div className="flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900">
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
              
              const canStartThisStop = isPending && (index === 0 || (stopsArray[index-1] && stopsArray[index-1].status === 'COMPLETED'));
              
              return (
                  <Card key={index} className={isCompleted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-card'}>
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
