# T08 — Adaptador de reservas e handoff para S09

- Status: Planejada
- Onda: 2, integração diferida
- Dependências: T01
- Paralelização: Com T06/T07

## Objetivo

Preparar a integração de caixinhas sem bloquear S08 e sem assumir um saldo
persistido que S09 ainda não oferece.

## Escopo

- Definir interface versionada para componentes de reserva protegida,
  discriminados por regra/caixinha e em `Money`; a implementação pré-S09
  devolve vazio/zero de modo explícito.
- Definir contrato de S09 para saldo derivado de movimentos, status de
  caixinha, referências opacas, data de corte e comportamento de aporte,
  retirada/encerramento.
- Registrar testes de integração que S09 deverá habilitar: reserva reduz o
  bruto uma vez, retirada aumenta uma vez, saldo negativo/encerrado segue a
  decisão de T01 e recursos restritos não são somados ao global.
- Atualizar o handoff de S09 com o proprietário da implementação final; não
  criar tabelas ou CRUD de caixinhas neste slice.

## Critérios de aceite

- [ ] S08 entrega normalmente sem S09 e o output declara a ausência de reserva.
- [ ] S09 pode plugar a fonte sem mudar API pública ou duplicar despesas.

