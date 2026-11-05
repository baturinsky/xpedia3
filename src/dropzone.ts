import { state } from "./state";

export function makeDropzone(dropZone: HTMLElement, onDrop: (files: FileList) => void) {
  if (dropZone) {
    let hoverClassName = 'hover';

    dropZone.addEventListener("dragenter", function (e) {
      e.preventDefault();
      dropZone.classList.add(hoverClassName);
    });

    dropZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropZone.classList.add(hoverClassName);
    });

    dropZone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      dropZone.classList.remove(hoverClassName);
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove(hoverClassName);

      if (!e.dataTransfer)
        return;

      // The status window is modal, so a second drop must not start a
      // concurrent load on top of the running one
      if (state.slowProcessStatus)
        return;

      onDrop(e.dataTransfer.files);
    });
  }

}