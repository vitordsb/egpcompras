import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  name: string;
  instruction: string;
  schedule_time: string;
  days_of_week: number[] | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_result: string | null;
}

interface Run {
  id: string;
  task_id: string;
  started_at: string;
  completed_at: string | null;
  result: string | null;
  status: string;
  task?: { name: string };
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fmtDate = (s: string | null) => s
  ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—';

export default function TarefasPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [tasksRes, runsRes] = await Promise.all([
      supabase.from('scheduled_tasks').select('*').order('schedule_time'),
      supabase.from('scheduled_task_runs')
        .select('id, task_id, started_at, completed_at, result, status, task:scheduled_tasks(name)')
        .order('started_at', { ascending: false })
        .limit(30),
    ]);
    setTasks((tasksRes.data ?? []) as Task[]);
    setRuns((runsRes.data ?? []) as unknown as Run[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle(task: Task) {
    await supabase.from('scheduled_tasks').update({ enabled: !task.enabled }).eq('id', task.id);
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, enabled: !t.enabled } : t));
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Remover a tarefa "${task.name}"?`)) return;
    await supabase.from('scheduled_tasks').delete().eq('id', task.id);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Tarefas Agendadas</h1>
        <p className="text-sm text-slate-500">
          A IA executa essas tarefas automaticamente no horário configurado (horário de Brasília).
        </p>
      </div>

      {/* Como configurar */}
      <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
        <strong>Como criar:</strong> Use o chat EGP — ex: <em>"todo dia às 09h, analisa as cotações em aberto"</em> ou <em>"toda segunda às 08h, me mostra os pedidos que ainda não saíram"</em>.
        <br />
        <strong>Execução:</strong> O endpoint <code className="rounded bg-brand-100 px-1">/api/run-scheduled-tasks</code> precisa ser chamado a cada 15 min por um serviço externo.
        Use <a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="underline">cron-job.org</a> (gratuito) para isso.
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : tasks.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Nenhuma tarefa criada ainda.</p>
            <p className="mt-1 text-xs text-slate-400">
              Crie pelo chat: <em>"marque para todo dia às 09h, analisar todas as cotações"</em>
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        task.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                      )} />
                      <span className="font-medium text-slate-900">{task.name}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                        {task.schedule_time} BRT
                        {task.days_of_week
                          ? ` — ${task.days_of_week.map((d) => DAYS[d]).join(', ')}`
                          : ' — todo dia'}
                      </span>
                      {task.last_status === 'error' && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">erro na última execução</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{task.instruction}</p>
                    {task.last_run_at && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Última execução: {fmtDate(task.last_run_at)}
                        {task.last_result && (
                          <span className="ml-2 text-slate-500">— {task.last_result.slice(0, 80)}{task.last_result.length > 80 ? '…' : ''}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(task)}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        task.enabled
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      )}
                    >
                      {task.enabled ? 'Pausar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTask(task)}
                      className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Histórico de execuções */}
      {runs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Histórico de execuções</h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Tarefa</th>
                    <th className="px-5 py-3">Iniciada em</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-2 font-medium text-slate-900">{(run.task as any)?.name ?? '—'}</td>
                      <td className="px-5 py-2 text-slate-500 whitespace-nowrap">{fmtDate(run.started_at)}</td>
                      <td className="px-5 py-2">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          run.status === 'ok'      ? 'bg-emerald-100 text-emerald-700' :
                          run.status === 'error'   ? 'bg-red-100 text-red-700' :
                                                     'bg-slate-100 text-slate-600'
                        )}>
                          {run.status === 'ok' ? '✓ OK' : run.status === 'error' ? '✗ Erro' : 'Rodando…'}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-xs text-slate-500 max-w-xs truncate">
                        {run.result ? run.result.slice(0, 100) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
