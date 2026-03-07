import { h, Fragment, render, Component, TargetedMouseEvent } from "preact";
import { GuiexpertTable } from "@guiexpert/preact-table";
import {
  GeMouseEvent,
  TableApi,
  TableFactory,
  TableModelIf,
  TableOptions,
  TableOptionsIf
} from "@guiexpert/table";

export type UIState = {
  initComplete: boolean
  foo: string
  tableData: any[][]
  tableModel: TableModelIf
}

let ui: UI;
export let state: UIState;

export const update = (data?: Partial<UIState>) => {
  if (!ui)
    return;
  if (!data)
    ui.forceUpdate()
  else
    return new Promise<void>(done => ui.setState(data, done));
}

export let tapi: TableApi;

function tableReady(api: TableApi) {
  console.info("onTableReady API:", api);
  tapi = api;
  return {}
}

const onMouseClicked = (evt) => {
  console.info('Mouse:', evt);
  return {}
};


class UI extends Component<{}, UIState> {
  state = {
    initComplete: false
  } as UIState

  constructor() {
    super();
    ui = this;
    this.state = state;
  }

  componentDidMount() {
    this.setState({ initComplete: true });
  }

  render() {
    state = this.state;
    console.log(state.tableData);

    const tableModel = TableFactory.createTableModel({
      rows: state.tableData || [],
      overridingColumnWidth: 110,
      tableOptions: { ...new TableOptions(), hoverColumnVisible: false, verticalBorderVisible: false, overflowY: "auto" }
    });

    return (
      <div style={{ overflowY: "hidden" }} key={state.tableData}>
        {state.foo} ic {`${state.initComplete}`}
        <GuiexpertTable
          tableModel={tableModel}
          mouseClicked={onMouseClicked}
          tableReady={tableReady}
        />
      </div>
    );
  }
}

export function initUI(_initialState: Partial<UIState>) {
  state = _initialState as UIState;
  let el = document.body

  render(<UI />, el);
}