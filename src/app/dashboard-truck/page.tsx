'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Loader2, Fuel, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

// Tipos para os dados do Firebase
type UserData = {
  id: string;
  name: string;
  isAdmin: boolean;
  truck: boolean;
  companyId: string;
  sectorId: string;
  matricula: string;
};

type Vehicle = {
  id: string;
  model: string;
  isTruck: boolean;
  imageUrl?: string;
  status?: 'PARADO' | 'EM CORRIDA' | 'EM TRAJETO';
  driverName?: string;
};

// Componente para o Card de Veículo
const VehicleCard = ({ vehicle }: { vehicle: Vehicle }) => {
    const getStatusColorClass = () => {
        switch (vehicle.status) {
            case 'EM CORRIDA': return 'bg-red-500';
            case 'EM TRAJETO': return 'bg-orange-500';
            case 'PARADO':
            default:
                return 'bg-green-500';
        }
    }

    const getCardBgColorClass = () => {
        switch (vehicle.status) {
            case 'EM CORRIDA': return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
            case 'EM TRAJETO': return 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800';
            case 'PARADO':
            default:
                return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
        }
    }

    return (
        <Card className={`text-center shadow-md ${getCardBgColorClass()}`}>
            <CardContent className="p-3">
                <p className="font-bold text-card-foreground">{vehicle.id}</p>
                <p className="text-xs text-muted-foreground mb-1">{vehicle.model}</p>
                <span className={`whitespace-nowrap text-white text-[10px] font-semibold px-2 py-0.5 rounded-full ${getStatusColorClass()}`}>
                    {vehicle.status}
                </span>
                {vehicle.driverName && <p className="text-xs text-muted-foreground mt-1 italic">{vehicle.driverName}</p>}
            </CardContent>
        </Card>
    )
}

// Componente da Página Principal
export default function DashboardTruckPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { firestore, auth, user: authUser } = useFirebase();
  const [user, setUser] = useState<UserData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Recupera dados do usuário do localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const companyId = localStorage.getItem('companyId');
    const sectorId = localStorage.getItem('sectorId');
    const matricula = localStorage.getItem('matricula');

    if (storedUser && companyId && sectorId && matricula) {
        const parsedUser = JSON.parse(storedUser);
      setUser({ ...parsedUser, companyId, sectorId, matricula });
    } else {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Sessão inválida. Por favor, faça login novamente.',
      });
      router.push('/login');
    }
  }, [router, toast]);
  
  // Busca os veículos e corridas ativas
  useEffect(() => {
    if (!firestore || !user || !authUser) return;
    
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch Vehicles
        const vehiclesCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/vehicles`);
        const vehiclesSnapshot = await getDocs(vehiclesCol);
        const vehiclesList: Vehicle[] = vehiclesSnapshot.docs
            .map(doc => ({ id: doc.id, ...(doc.data() as Omit<Vehicle, 'id'>) }))
            .filter(v => v.isTruck)
            .map(v => ({ ...v, status: 'PARADO' })); // Default status

        // Fetch active runs to update vehicle status and find user's active run
        const runsCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/runs`);
        const activeRunsQuery = query(runsCol, where('status', '==', 'IN_PROGRESS'));
        const activeRunsSnapshot = await getDocs(activeRunsQuery);

        const activeRunsData: { [vehicleId: string]: string } = {};
        let userActiveRunId: string | null = null;
        
        activeRunsSnapshot.forEach(doc => {
            const run = doc.data();
            activeRunsData[run.vehicleId] = run.driverName;
            if (run.driverId === authUser.uid) {
                userActiveRunId = doc.id;
            }
        });

        setActiveRunId(userActiveRunId);

        // Update vehicle status based on active runs
        const updatedVehiclesList = vehiclesList.map(vehicle => {
            if (activeRunsData[vehicle.id]) {
                return {
                    ...vehicle,
                    status: 'EM CORRIDA' as const,
                    driverName: activeRunsData[vehicle.id]
                };
            }
            return vehicle;
        });
        
        setVehicles(updatedVehiclesList);

      } catch (error) {
        console.error("Erro ao buscar dados:", error);
        toast({
          variant: 'destructive',
          title: 'Erro de Rede',
          description: 'Não foi possível carregar os dados do dashboard.',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Atualiza a cada 30 segundos
    return () => clearInterval(interval);

  }, [firestore, user, authUser, toast]);

  const handleLogout = () => {
    if (confirm('Tem certeza que deseja sair da conta?')) {
      auth?.signOut();
      localStorage.clear();
      router.push('/login');
      toast({ title: 'Desconectado', description: 'Você saiu da sua conta.' });
    }
  };

  const handleStartOrContinueRun = () => {
    if (activeRunId) {
      router.push(`/dashboard-truck/active-run?id=${activeRunId}`);
    } else {
      router.push('/dashboard-truck/run');
    }
  };

  if (!user || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-black">
      <main className="flex-1 p-4 sm:p-6 lg:p-8 container mx-auto max-w-md">
        <header className="flex justify-between items-center mb-8">
            <div className="text-left">
                <p className="text-lg font-semibold text-foreground">{user.name}</p>
                <p className="text-sm text-muted-foreground">Matrícula: {user.matricula}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5 text-muted-foreground" />
              <span className="sr-only">Sair</span>
            </Button>
        </header>

        <section className="space-y-4">
            <Button className="w-full h-24 text-xl font-bold" onClick={handleStartOrContinueRun} variant="secondary">
                <PlayCircle className="mr-3 h-8 w-8"/>
                {activeRunId ? 'Continuar Trajeto' : 'Iniciar Trajeto'}
            </Button>
            <Button className="w-full h-16 text-lg" variant="outline" onClick={() => router.push('/dashboard-truck/refuel')}>
                <Fuel className="mr-3"/>
                Registrar Abastecimento
            </Button>
        </section>
        
        <section className="mt-8">
            <Accordion type="single" collapsible>
              <AccordionItem value="item-1" className="border-none">
                <AccordionTrigger className="justify-center text-muted-foreground hover:no-underline text-sm py-2">
                  Ver Status da Frota
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 ml-1" />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="bg-card rounded-xl p-4 shadow-sm border mt-2">
                      {isLoading ? (
                          <div className="text-center text-muted-foreground flex items-center justify-center p-4">
                              <Loader2 className="w-5 h-5 mr-2 animate-spin"/> Carregando...
                          </div>
                      ) : vehicles.length === 0 ? (
                          <p className="text-center text-muted-foreground p-4">Nenhum caminhão encontrado.</p>
                      ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {vehicles.map(v => <VehicleCard key={v.id} vehicle={v} />)}
                          </div>
                      )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
        </section>
      </main>
    </div>
  );
}
