'use client';

import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFirebase } from '@/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle } from 'lucide-react';
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

// Schemas
const companySchema = z.object({
  companyId: z.string().min(1, 'ID da Empresa é obrigatório'),
  companyName: z.string().min(1, 'Nome da Empresa é obrigatório'),
});

const sectorSchema = z.object({
  companyId: z.string().min(1, 'Selecione uma empresa'),
  sectorId: z.string().min(1, 'ID do Setor é obrigatório'),
  sectorName: z.string().min(1, 'Nome do setor é obrigatório')
});

const vehicleSchema = z.object({
  companyId: z.string().min(1, 'Selecione uma empresa'),
  sectorId: z.string().min(1, 'Selecione um setor'),
  vehicleId: z.string().min(1, 'ID do Veículo (placa) é obrigatório'),
  model: z.string().min(1, 'Modelo é obrigatório'),
  imageUrl: z.string().url('URL da imagem inválida').optional(),
});

const userSchema = z.object({
  companyId: z.string().min(1, 'Selecione uma empresa'),
  sectorId: z.string().min(1, 'Selecione um setor'),
  userName: z.string().min(1, 'Nome do usuário é obrigatório'),
  userMatricula: z.string().min(1, 'Matrícula é obrigatória'),
  userPassword: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
  isTruckDriver: z.boolean().default(false),
});

type CompanyFormValues = z.infer<typeof companySchema>;
type SectorFormValues = z.infer<typeof sectorSchema>;
type VehicleFormValues = z.infer<typeof vehicleSchema>;
type UserFormValues = z.infer<typeof userSchema>;

type Company = { id: string; name: string };
type Sector = { id: string; name: string };

export default function AdminPage() {
  const { firestore, auth } = useFirebase();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sectorsUser, setSectorsUser] = useState<Sector[]>([]);
  const [sectorsVehicle, setSectorsVehicle] = useState<Sector[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState<Record<string, boolean>>({});

  const companyForm = useForm<CompanyFormValues>({ resolver: zodResolver(companySchema) });
  const sectorForm = useForm<SectorFormValues>({ resolver: zodResolver(sectorSchema) });
  const vehicleForm = useForm<VehicleFormValues>({ resolver: zodResolver(vehicleSchema) });
  const userForm = useForm<UserFormValues>({ resolver: zodResolver(userSchema) });

  const selectedCompanyUserForm = userForm.watch('companyId');
  const selectedCompanyVehicleForm = vehicleForm.watch('companyId');

  const fetchCompanies = async () => {
    if (!firestore) return;
    setIsLoadingCompanies(true);
    try {
      const companiesCol = collection(firestore, 'companies');
      const companySnapshot = await getDocs(companiesCol);
      const companyList = companySnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
      setCompanies(companyList);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar as empresas.' });
    } finally {
      setIsLoadingCompanies(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [firestore]);

  const fetchSectors = async (companyId: string | undefined, setSectorsCallback: (sectors: Sector[]) => void, resetSectorId: () => void) => {
    if (!firestore || !companyId) {
      setSectorsCallback([]);
      resetSectorId();
      return;
    }
    try {
      const sectorsCol = collection(firestore, `companies/${companyId}/sectors`);
      const sectorSnapshot = await getDocs(sectorsCol);
      const sectorList = sectorSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string }));
      setSectorsCallback(sectorList);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível carregar os setores.' });
    }
  };


  useEffect(() => {
    fetchSectors(selectedCompanyUserForm, setSectorsUser, () => userForm.setValue('sectorId', ''));
  }, [selectedCompanyUserForm, firestore, userForm]);

  useEffect(() => {
    fetchSectors(selectedCompanyVehicleForm, setSectorsVehicle, () => vehicleForm.setValue('sectorId', ''));
  }, [selectedCompanyVehicleForm, firestore, vehicleForm]);


  const handleSubmission = async (formName: string, action: () => Promise<void>) => {
    setIsSubmitting(prev => ({ ...prev, [formName]: true }));
    try {
      await action();
    } catch (error: any) {
      console.error(`Erro ao cadastrar ${formName}:`, error);
      toast({
        variant: 'destructive',
        title: `Erro ao cadastrar ${formName}`,
        description: error.message || 'Ocorreu um erro inesperado.',
      });
    } finally {
      setIsSubmitting(prev => ({ ...prev, [formName]: false }));
    }
  };

  const onCompanySubmit = async (data: CompanyFormValues) => {
    await handleSubmission('empresa', async () => {
      if (!firestore) throw new Error('Firestore não disponível');
      const companyRef = doc(firestore, 'companies', data.companyId);
      await setDoc(companyRef, { name: data.companyName });
      toast({ title: 'Sucesso', description: 'Empresa cadastrada!' });
      companyForm.reset();
      fetchCompanies(); // Refresh companies list
    });
  };

  const onSectorSubmit = async (data: SectorFormValues) => {
    await handleSubmission('setor', async () => {
      if (!firestore) throw new Error('Firestore não disponível');
      const sectorRef = doc(firestore, `companies/${data.companyId}/sectors`, data.sectorId);
      await setDoc(sectorRef, { name: data.sectorName });
      toast({ title: 'Sucesso', description: 'Setor cadastrado!' });
      sectorForm.reset();
    });
  };
  
  const onVehicleSubmit = async (data: VehicleFormValues) => {
    await handleSubmission('veículo', async () => {
      if (!firestore) throw new Error('Firestore não disponível');
      const vehicleRef = doc(firestore, `companies/${data.companyId}/sectors/${data.sectorId}/vehicles`, data.vehicleId);
      await setDoc(vehicleRef, { model: data.model, imageUrl: data.imageUrl || '' });
      toast({ title: 'Sucesso', description: 'Veículo cadastrado!' });
      vehicleForm.reset();
    });
  };

  const onUserSubmit = async (data: UserFormValues) => {
    await handleSubmission('usuário', async () => {
        if (!firestore || !auth) throw new Error('Firebase não disponível');

        // 1. Create user in Firebase Auth
        const email = `${data.userMatricula}@frotacontrol.com`;
        const userCredential = await createUserWithEmailAndPassword(auth, email, data.userPassword);
        const user = userCredential.user;

        // 2. Create user document in Firestore
        const userRef = doc(firestore, `companies/${data.companyId}/sectors/${data.sectorId}/users`, user.uid);
        await setDoc(userRef, {
            name: data.userName,
            truck: data.isTruckDriver,
            // Security: We don't store the password in Firestore. Auth handles it.
        });

        toast({ title: 'Sucesso', description: 'Usuário cadastrado com sucesso!' });
        userForm.reset();
    });
};


  const renderLoading = (formName: string) => isSubmitting[formName] && <Loader2 className="mr-2 h-4 w-4 animate-spin" />;

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Painel de Cadastro (Temporário)</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Cadastrar Empresa */}
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar Nova Empresa</CardTitle>
            <CardDescription>Adicione uma nova empresa ao sistema.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={companyForm.handleSubmit(onCompanySubmit)} className="space-y-4">
              <Input {...companyForm.register('companyId')} placeholder="ID da Empresa (Ex: LSL)" />
              {companyForm.formState.errors.companyId && <p className="text-sm text-destructive">{companyForm.formState.errors.companyId.message}</p>}
              
              <Input {...companyForm.register('companyName')} placeholder="Nome da Empresa (Ex: Logística S.A.)" />
               {companyForm.formState.errors.companyName && <p className="text-sm text-destructive">{companyForm.formState.errors.companyName.message}</p>}

              <Button type="submit" disabled={isSubmitting['empresa']}>
                {renderLoading('empresa')} Cadastrar Empresa
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Cadastrar Setor */}
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar Novo Setor</CardTitle>
            <CardDescription>Adicione um setor a uma empresa existente.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={sectorForm.handleSubmit(onSectorSubmit)} className="space-y-4">
              <Controller
                name="companyId"
                control={sectorForm.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingCompanies}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCompanies ? "Carregando..." : "Selecione a Empresa"} />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {sectorForm.formState.errors.companyId && <p className="text-sm text-destructive">{sectorForm.formState.errors.companyId.message}</p>}

              <Input {...sectorForm.register('sectorId')} placeholder="ID do Setor (Ex: MILKRUN)" />
              {sectorForm.formState.errors.sectorId && <p className="text-sm text-destructive">{sectorForm.formState.errors.sectorId.message}</p>}
              
              <Input {...sectorForm.register('sectorName')} placeholder="Nome do Setor (Ex: Milk Run)" />
              {sectorForm.formState.errors.sectorName && <p className="text-sm text-destructive">{sectorForm.formState.errors.sectorName.message}</p>}

              <Button type="submit" disabled={isSubmitting['setor']}>
                {renderLoading('setor')} Cadastrar Setor
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Cadastrar Veículo */}
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar Novo Veículo</CardTitle>
            <CardDescription>Adicione um veículo a uma empresa e setor.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={vehicleForm.handleSubmit(onVehicleSubmit)} className="space-y-4">
               <Controller
                name="companyId"
                control={vehicleForm.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingCompanies}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCompanies ? "Carregando..." : "Selecione a Empresa"} />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {vehicleForm.formState.errors.companyId && <p className="text-sm text-destructive">{vehicleForm.formState.errors.companyId.message}</p>}

              <Controller
                name="sectorId"
                control={vehicleForm.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value} disabled={!selectedCompanyVehicleForm || sectorsVehicle.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder={!selectedCompanyVehicleForm ? "Selecione uma empresa primeiro" : "Selecione o Setor"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sectorsVehicle.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {vehicleForm.formState.errors.sectorId && <p className="text-sm text-destructive">{vehicleForm.formState.errors.sectorId.message}</p>}

              <Input {...vehicleForm.register('vehicleId')} placeholder="ID/Placa do Veículo" />
              {vehicleForm.formState.errors.vehicleId && <p className="text-sm text-destructive">{vehicleForm.formState.errors.vehicleId.message}</p>}
              
              <Input {...vehicleForm.register('model')} placeholder="Modelo do Veículo" />
              {vehicleForm.formState.errors.model && <p className="text-sm text-destructive">{vehicleForm.formState.errors.model.message}</p>}

              <Input {...vehicleForm.register('imageUrl')} placeholder="URL da Imagem do Veículo" />
              {vehicleForm.formState.errors.imageUrl && <p className="text-sm text-destructive">{vehicleForm.formState.errors.imageUrl.message}</p>}

              <Button type="submit" disabled={isSubmitting['veículo']}>
                {renderLoading('veículo')} Cadastrar Veículo
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Cadastrar Usuário */}
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar Novo Usuário</CardTitle>
            <CardDescription>Adicione um novo usuário a um setor.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={userForm.handleSubmit(onUserSubmit)} className="space-y-4">
               <Controller
                name="companyId"
                control={userForm.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingCompanies}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingCompanies ? "Carregando..." : "Selecione a Empresa"} />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {userForm.formState.errors.companyId && <p className="text-sm text-destructive">{userForm.formState.errors.companyId.message}</p>}

              <Controller
                name="sectorId"
                control={userForm.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value} disabled={!selectedCompanyUserForm || sectorsUser.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder={!selectedCompanyUserForm ? "Selecione uma empresa primeiro" : "Selecione o Setor"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sectorsUser.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {userForm.formState.errors.sectorId && <p className="text-sm text-destructive">{userForm.formState.errors.sectorId.message}</p>}

              <Input {...userForm.register('userName')} placeholder="Nome do Usuário" />
              {userForm.formState.errors.userName && <p className="text-sm text-destructive">{userForm.formState.errors.userName.message}</p>}
              
              <Input {...userForm.register('userMatricula')} placeholder="Matrícula do Usuário" />
              {userForm.formState.errors.userMatricula && <p className="text-sm text-destructive">{userForm.formState.errors.userMatricula.message}</p>}

              <Input type="password" {...userForm.register('userPassword')} placeholder="Senha do Usuário" />
              {userForm.formState.errors.userPassword && <p className="text-sm text-destructive">{userForm.formState.errors.userPassword.message}</p>}
              
              <div className="flex items-center space-x-2">
                <Controller
                    name="isTruckDriver"
                    control={userForm.control}
                    render={({ field }) => (
                        <Switch
                            id="isTruckDriver"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                        />
                    )}
                />
                <Label htmlFor="isTruckDriver">É motorista de caminhão (truck)?</Label>
              </div>

              <Button type="submit" disabled={isSubmitting['usuário']}>
                {renderLoading('usuário')} Cadastrar Usuário
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
