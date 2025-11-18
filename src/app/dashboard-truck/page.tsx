'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { collection, getDocs } from 'firebase/firestore';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Loader2 } from 'lucide-react';
import { Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  status?: 'NO ESTACIONAMENTO' | 'EM CORRIDA' | 'EM ACOMPANHAMENTO';
  driverName?: string;
};

// Componente para o Card de Veículo
const VehicleCard = ({ vehicle }: { vehicle: Vehicle }) => {
    const getStatusColorClass = () => {
        switch (vehicle.status) {
            case 'EM CORRIDA': return 'bg-red-500';
            case 'EM ACOMPANHAMENTO': return 'bg-orange-500';
            case 'NO ESTACIONAMENTO':
            default:
                return 'bg-green-500';
        }
    }

    const getCardBgColorClass = () => {
        switch (vehicle.status) {
            case 'EM CORRIDA': return 'bg-red-50 border-red-200';
            case 'EM ACOMPANHAMENTO': return 'bg-orange-50 border-orange-200';
            case 'NO ESTACIONAMENTO':
            default:
                return 'bg-green-50 border-green-200';
        }
    }

    return (
        <Card className={`text-center shadow-md ${getCardBgColorClass()}`}>
            <CardContent className="p-3">
                <p className="font-bold text-gray-800">{vehicle.id}</p>
                <p className="text-xs text-gray-600 mb-1">{vehicle.model}</p>
                <span className={`text-white text-[10px] font-semibold px-2 py-0.5 rounded-full ${getStatusColorClass()}`}>
                    {vehicle.status}
                </span>
                <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: '100%' }}></div>
                </div>
                {vehicle.driverName && <p className="text-xs text-gray-500 mt-1 italic">{vehicle.driverName}</p>}
            </CardContent>
        </Card>
    )
}

// Componente da Página Principal
export default function DashboardTruckPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { firestore, auth } = useFirebase();
  const [user, setUser] = useState<UserData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);

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
  
  // Busca os veículos
  useEffect(() => {
    if (!firestore || !user) return;

    const fetchVehicles = async () => {
      setIsLoadingVehicles(true);
      try {
        const vehiclesCol = collection(firestore, `companies/${user.companyId}/sectors/${user.sectorId}/vehicles`);
        const querySnapshot = await getDocs(vehiclesCol);
        
        const vehiclesList: Vehicle[] = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...(doc.data() as Omit<Vehicle, 'id'>) }))
            .filter(v => v.isTruck)
            // Lógica de status simulada - você precisará conectar com os dados reais de corridas
            .map(v => ({
                ...v,
                status: 'NO ESTACIONAMENTO',
            }));

        setVehicles(vehiclesList);

      } catch (error) {
        console.error("Erro ao buscar veículos:", error);
        toast({
          variant: 'destructive',
          title: 'Erro de Rede',
          description: 'Não foi possível carregar os dados dos caminhões.',
        });
      } finally {
        setIsLoadingVehicles(false);
      }
    };

    fetchVehicles();
    const interval = setInterval(fetchVehicles, 30000); // Atualiza a cada 30 segundos
    return () => clearInterval(interval);

  }, [firestore, user, toast]);

  const handleLogout = () => {
    if (confirm('Tem certeza que deseja sair da conta?')) {
      auth?.signOut();
      localStorage.clear();
      router.push('/login');
      toast({ title: 'Desconectado', description: 'Você saiu da sua conta.' });
    }
  };

  const handleStartRun = () => {
    router.push('/dashboard-truck/run');
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-background">
        {/* Cabeçalho */}
        <header className="p-5 relative shadow-lg bg-card text-card-foreground border-b">
            <h1 className="text-3xl font-bold font-headline text-primary">FROTACONTROL</h1>
            <p className="text-sm mt-2">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.matricula}</p>
            <Truck className="absolute top-5 right-5 w-10 h-10 opacity-20 text-primary" />
        </header>

        {/* Conteúdo Principal */}
        <main className="flex-1 bg-gray-100 p-4">
            <section>
                <h2 className="text-lg font-semibold text-gray-600 mb-3">Status dos Caminhões</h2>
                <div className="bg-white rounded-xl p-4 shadow-sm border">
                    {isLoadingVehicles ? (
                        <div className="text-center text-gray-500 flex items-center justify-center p-4">
                            <Loader2 className="w-5 h-5 mr-2 animate-spin"/> Carregando...
                        </div>
                    ) : vehicles.length === 0 ? (
                        <p className="text-center text-gray-500 p-4">Nenhum caminhão encontrado.</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                           {vehicles.map(v => <VehicleCard key={v.id} vehicle={v} />)}
                        </div>
                    )}
                </div>
            </section>
            
            <section className="mt-6">
                <h2 className="text-lg font-semibold text-gray-600 mb-3">Acompanhamento</h2>
                <Button className="w-full h-20 text-lg bg-primary text-primary-foreground shadow-lg hover:bg-primary/90" onClick={handleStartRun}>
                    <PlayCircle className="mr-3"/>
                    Iniciar/Acompanhar
                </Button>
            </section>

            <section className="mt-6">
                <h2 className="text-lg font-semibold text-gray-600 mb-3">Conta</h2>
                <Button variant="outline" className="w-full h-16 text-base" onClick={handleLogout}>
                    <LogOut className="mr-3"/>
                    Sair
                </Button>
            </section>
        </main>
    </div>
  );
}
