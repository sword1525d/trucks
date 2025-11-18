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
import { Loader2 } from 'lucide-react';
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import Link from 'next/link';

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
  isTruck: z.boolean().default(false),
  imageUrl: z.string().optional(),
}).refine(data => data.isTruck || (data.imageUrl && data.imageUrl.length > 0), {
  message: 'URL da imagem é obrigatória para veículos que não são caminhões',
  path: ['imageUrl'],
});


const userSchema = z.object({
  companyId: z.string().min(1, 'Selecione uma empresa'),
  sectorId: z.string().min(1, 'Selecione um setor'),
  userName: z.string().min(1, 'Nome do usuário é obrigatório'),
  userMatricula: z.string().min(1, 'Matrícula é obrigatória'),
  userPassword: z.string().min(1, 'A senha é obrigatória'),
  isTruckDriver: z.boolean().default(false),
  isAdmin: z.boolean().default(false),
});

type CompanyFormValues = z.infer<typeof companySchema>;
type SectorFormValues = z.infer<typeof sectorSchema>;
type VehicleFormValues = z.infer<typeof vehicleSchema>;
type UserFormValues = z.infer<typeof userSchema>;

type Company = { id: string; name: string };
type Sector = { id: string; name: string };

const defaultUserValues = {
  companyId: '',
  sectorId: '',
  userName: '',
  userMatricula: '',
  userPassword: '',
  isTruckDriver: false,
  isAdmin: false,
};

const defaultVehicleValues = {
  companyId: '',
  sectorId: '',
  vehicleId: '',
  model: '',
  imageUrl: '',
  isTruck: false,
};

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
  const vehicleForm = useForm<VehicleFormValues>({ resolver: zodResolver(vehicleSchema), defaultValues: defaultVehicleValues });
  const userForm = useForm<UserFormValues>({ resolver: zodResolver(userSchema), defaultValues: defaultUserValues });

  const selectedCompanyUserForm = userForm.watch('companyId');
  const selectedCompanyVehicleForm = vehicleForm.watch('companyId');
  const isVehicleTruck = vehicleForm.watch('isTruck');

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
    setSectorsCallback([]); // Sempre limpa os setores antes de buscar novos
    resetSectorId();
    if (!firestore || !companyId) {
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
    fetchSectors(selectedCompanyUserForm, setSectorsUser, () => userForm.resetField('sectorId'));
  }, [selectedCompanyUserForm, firestore, userForm]);

  useEffect(() => {
    fetchSectors(selectedCompanyVehicleForm, setSectorsVehicle, () => vehicleForm.resetField('sectorId'));
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
      companyForm.reset({ companyId: '', companyName: ''});
      fetchCompanies(); // Refresh companies list
    });
  };

  const onSectorSubmit = async (data: SectorFormValues) => {
    await handleSubmission('setor', async () => {
      if (!firestore) throw new Error('Firestore não disponível');
      const sectorRef = doc(firestore, `companies/${data.companyId}/sectors`, data.sectorId);
      await setDoc(sectorRef, { name: data.sectorName });
      toast({ title: 'Sucesso', description: 'Setor cadastrado!' });
      sectorForm.reset({ companyId: '', sectorId: '', sectorName: ''});
    });
  };
  
  const onVehicleSubmit = async (data: VehicleFormValues) => {
    await handleSubmission('veículo', async () => {
      if (!firestore) throw new Error('Firestore não disponível');
      const vehicleRef = doc(firestore, `companies/${data.companyId}/sectors/${data.sectorId}/vehicles`, data.vehicleId);
      await setDoc(vehicleRef, { 
        model: data.model, 
        isTruck: data.isTruck,
        imageUrl: data.isTruck ? '' : data.imageUrl || '' 
      });
      toast({ title: 'Sucesso', description: 'Veículo cadastrado!' });
      vehicleForm.reset(defaultVehicleValues);
    });
  };

  const onUserSubmit = async (data: UserFormValues) => {
    await handleSubmission('usuário', async () => {
        if (!firestore || !auth) throw new Error('Firebase não disponível');

        // 1. Pad password if needed
        let password = data.userPassword;
        if (password.length < 6) {
          password = password.padStart(6, '0');
        }

        // 2. Create user in Firebase Auth
        const email = `${data.userMatricula}@frotacontrol.com`;
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 3. Create user document in Firestore
        const userRef = doc(firestore, `companies/${data.companyId}/sectors/${data.sectorId}/users`, user.uid);
        await setDoc(userRef, {
            name: data.userName.toUpperCase(),
            truck: data.isTruckDriver,
            isAdmin: data.isAdmin,
            // Security: We don't store the password in Firestore. Auth handles it.
        });

        toast({ title: 'Sucesso', description: 'Usuário cadastrado com sucesso!' });
        userForm.reset(defaultUserValues);
    });
};


  const renderLoading = (formName: string) => isSubmitting[formName] && <Loader2 className="mr-2 h-4 w-4 animate-spin" />;

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Painel de Cadastro</h1>
          <p className="text-muted-foreground">Adicione empresas, setores, veículos e usuários ao sistema.</p>
          <div className="mt-4 text-center text-sm">
            <Link href="/login" className="underline underline-offset-4 hover:text-primary">
              Voltar para o Login
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Cadastrar Empresa */}
          <Card>
            <CardHeader>
              <CardTitle>Nova Empresa</CardTitle>
              <CardDescription>Adicione uma nova empresa.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={companyForm.handleSubmit(onCompanySubmit)} className="space-y-4">
                <Input {...companyForm.register('companyId')} placeholder="ID da Empresa (Ex: LSL)" />
                {companyForm.formState.errors.companyId && <p className="text-sm text-destructive">{companyForm.formState.errors.companyId.message}</p>}
                
                <Input {...companyForm.register('companyName')} placeholder="Nome da Empresa (Ex: Logística S.A.)" />
                {companyForm.formState.errors.companyName && <p className="text-sm text-destructive">{companyForm.formState.errors.companyName.message}</p>}

                <Button type="submit" disabled={isSubmitting['empresa']} className="w-full">
                  {renderLoading('empresa')} Cadastrar Empresa
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Cadastrar Setor */}
          <Card>
            <CardHeader>
              <CardTitle>Novo Setor</CardTitle>
              <CardDescription>Adicione um setor a uma empresa.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={sectorForm.handleSubmit(onSectorSubmit)} className="space-y-4">
                <Controller
                  name="companyId"
                  control={sectorForm.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoadingCompanies}>
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

                <Button type="submit" disabled={isSubmitting['setor']} className="w-full">
                  {renderLoading('setor')} Cadastrar Setor
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Cadastrar Veículo */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Novo Veículo</CardTitle>
              <CardDescription>Adicione um veículo a uma empresa e setor.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={vehicleForm.handleSubmit(onVehicleSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Controller
                    name="companyId"
                    control={vehicleForm.control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoadingCompanies}>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingCompanies ? "Carregando..." : "Selecione a Empresa"} />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <Controller
                    name="sectorId"
                    control={vehicleForm.control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={!selectedCompanyVehicleForm || sectorsVehicle.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder={!selectedCompanyVehicleForm ? "Selecione uma empresa" : "Selecione o Setor"} />
                        </SelectTrigger>
                        <SelectContent>
                          {sectorsVehicle.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {vehicleForm.formState.errors.companyId && <p className="text-sm text-destructive">{vehicleForm.formState.errors.companyId.message}</p>}
                {vehicleForm.formState.errors.sectorId && <p className="text-sm text-destructive -mt-3">{vehicleForm.formState.errors.sectorId.message}</p>}


                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input {...vehicleForm.register('vehicleId')} placeholder="ID/Placa do Veículo" />
                  <Input {...vehicleForm.register('model')} placeholder="Modelo do Veículo" />
                </div>
                {vehicleForm.formState.errors.vehicleId && <p className="text-sm text-destructive">{vehicleForm.formState.errors.vehicleId.message}</p>}
                {vehicleForm.formState.errors.model && <p className="text-sm text-destructive -mt-3">{vehicleForm.formState.errors.model.message}</p>}


                <div className="flex items-center space-x-2 pt-2">
                  <Controller
                      name="isTruck"
                      control={vehicleForm.control}
                      render={({ field }) => (
                          <Switch
                              id="isTruck"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                          />
                      )}
                  />
                  <Label htmlFor="isTruck">É caminhão?</Label>
                </div>

                {!isVehicleTruck && (
                  <div>
                      <Input {...vehicleForm.register('imageUrl')} placeholder="URL da Imagem do Veículo" />
                      {vehicleForm.formState.errors.imageUrl && <p className="text-sm text-destructive mt-1">{vehicleForm.formState.errors.imageUrl.message}</p>}
                  </div>
                )}

                <Button type="submit" disabled={isSubmitting['veículo']} className="w-full">
                  {renderLoading('veículo')} Cadastrar Veículo
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Cadastrar Usuário */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Novo Usuário</CardTitle>
              <CardDescription>Adicione um novo usuário a um setor.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={userForm.handleSubmit(onUserSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Controller
                    name="companyId"
                    control={userForm.control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={isLoadingCompanies}>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingCompanies ? "Carregando..." : "Selecione a Empresa"} />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <Controller
                    name="sectorId"
                    control={userForm.control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={!selectedCompanyUserForm || sectorsUser.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder={!selectedCompanyUserForm ? "Selecione uma empresa" : "Selecione o Setor"} />
                        </SelectTrigger>
                        <SelectContent>
                          {sectorsUser.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                 {userForm.formState.errors.companyId && <p className="text-sm text-destructive">{userForm.formState.errors.companyId.message}</p>}
                 {userForm.formState.errors.sectorId && <p className="text-sm text-destructive -mt-3">{userForm.formState.errors.sectorId.message}</p>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input {...userForm.register('userName')} placeholder="Nome do Usuário" />
                  <Input {...userForm.register('userMatricula')} placeholder="Matrícula do Usuário" />
                </div>
                 {userForm.formState.errors.userName && <p className="text-sm text-destructive">{userForm.formState.errors.userName.message}</p>}
                 {userForm.formState.errors.userMatricula && <p className="text-sm text-destructive -mt-3">{userForm.formState.errors.userMatricula.message}</p>}


                <Input type="password" {...userForm.register('userPassword')} placeholder="Senha do Usuário" />
                {userForm.formState.errors.userPassword && <p className="text-sm text-destructive">{userForm.formState.errors.userPassword.message}</p>}
                
                <div className="flex items-center space-x-2 pt-2">
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
                  <Label htmlFor="isTruckDriver">É motorista de caminhão?</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Controller
                      name="isAdmin"
                      control={userForm.control}
                      render={({ field }) => (
                          <Switch
                              id="isAdmin"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                          />
                      )}
                  />
                  <Label htmlFor="isAdmin">É Administrador?</Label>
                </div>

                <Button type="submit" disabled={isSubmitting['usuário']} className="w-full">
                  {renderLoading('usuário')} Cadastrar Usuário
                </Button>
              </form>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
