import { Component, ViewChildren, ViewChild, QueryList } from '@angular/core';
import { NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AppState } from '../app.service';
import { AutoComplete } from 'primeng/primeng';
import { MdInput } from '@angular/material';

import { Appointment }           from '../api/model/appointment';
import { AppointmentService }    from '../api/api/appointment.service';
import { Examination }           from '../api/model/examination';
import { ExaminationService }    from '../api/api/examination.service';
import { Patient }               from '../api/model/patient';
import { PatientService }        from '../api/api/patient.service';
import { Room }                  from '../api/model/room';
import { RoomService }           from '../api/api/room.service';
import { NotificationService }   from '../api/api/notification.service';
import { NotificationBuilder }   from './notificationBuilder';
import { Translation,
  getI18nStrings }               from './appointment.translations';

import * as moment               from 'moment';
import * as humanizeDuration     from 'humanize-duration';

@Component({
  templateUrl: './appointment-detail.html',
  styleUrls: [ './appointment-detail.style.scss' ]
})

export class AppointmentDetailComponent {

  private editing: boolean = false;
  private trans: Translation;
  private rooms: Room[] = undefined;
  private filteredPatients: Patient[] = undefined;
  private filteredExaminations: Examination[] = undefined;
  private proposedTimeSlots: any[] = [];
  private localeHumanizer: any;
  private isTwelveHours: boolean;
  @ViewChildren('examMultiChooser') private examsMultiInput: QueryList<AutoComplete>;
  @ViewChild('duration') private durationInput: MdInput;
  private model: AppointmentViewModel = {
    id: undefined,
    title: undefined,
    description: undefined,
    date: undefined,
    time: undefined,
    duration: undefined,
    roomId: undefined,
    patient: undefined,
    examinations: undefined,
    reminders: undefined
  };

  constructor(
    private _state: AppState,
    private route: ActivatedRoute,
    private router: Router,
    private appointmentService: AppointmentService,
    private examinationService: ExaminationService,
    private roomService: RoomService,
    private patientService: PatientService,
    private notificationService: NotificationService) {}

  ngOnInit(): void {
    let param: string = this.route.snapshot.params['id'];

    // Mouseflow integration
    if ((<any>window)._mfq) {
      (<any>window)._mfq.push(['newPageView', '/appointment/' + param]);
    }

    // This is a sub-page
    this._state.isSubPage.next(true);
    this._state.title.next();
    this._state.actions.next();
    this._state.primaryAction.next();

    // Set up localized humanizer for durations
    this.localeHumanizer = humanizeDuration.humanizer({
      language: localStorage.getItem('locale').startsWith('de') ? 'de' : 'en'
    });

    this.isTwelveHours = this.isCurrentLocaleUsingTwelveHours();

    this.trans = getI18nStrings();

    // Create new appointment
    if (param === 'add') {
      this.editing = true;

    // View or edit existing appointment
    } else if (Number(param) !== NaN) {
      this.editing = false;
      console.log('displaying appointment with id: %d', Number(param));
      this.getAppointmentById(Number(param));
    }

    this.getAllRooms();
  }

  ngAfterViewInit() {
    // Set placeholder for examinations input
    for (let autoComplete of this.examsMultiInput.toArray()) {
      autoComplete.input.placeholder = this.trans.examination;
    }
  }

  onSubmit(): void {
    let newAppointment: Appointment  = {
      title: this.model.title,
      description: this.model.description,
      modified: new Date(),
      created: new Date(),
      modifiedBy: 0,
      createdBy: 0,
      patientId: this.model.patient.id,
      roomId: this.model.roomId
    };
    let examinations: Examination[] = this.model.examinations;
    let startDate = moment(this.model.date, 'l');
    let startTime = moment(this.model.time, 'LT');
    let start = startDate.clone();
    start.hour(startTime.hour());
    start.minute(startTime.minute());
    let end: moment.Moment = start.clone();
    end.add(moment.duration('PT' + this.model.duration));
    newAppointment.start = start.toDate();
    newAppointment.end = end.toDate();

    // Add...
    if (!this.model.id) {
      this.appointmentService
      .appointmentCreate(newAppointment)
      .subscribe(
        x => {

          // Link examinations
          if (examinations && examinations.length > 0) {
            for (let i = 0; i < examinations.length; ++i) {
              this.linkExaminationWithAppointment(x, examinations[i]);
            }
          }

          // Create reminders
          if (this.model.reminders) {
            this.notificationService.notificationCreate(
              NotificationBuilder.getNotification(
                x,
                this.model.emailReminder ? this.model.patient.email : undefined,
                this.model.smsReminder ? this.model.patient.phone : undefined
              ))
            .subscribe(
              null,
              err => console.log(err),
              () => console.log('Created notification.')
            );
          }

        },
        e => { console.log('onError: %o', e); },
        () => { console.log('Completed insert.'); }
      );

    // ...or update
    } else {
      this.appointmentService
      .appointmentPrototypeUpdateAttributes(this.model.id.toString(), newAppointment)
      .subscribe(
        x => {
          for (let i = 0; i < examinations.length; ++i) {
            this.linkExaminationWithAppointment(x, examinations[i]);
          }
          // TODO Reminders currently being ignored on update
        },
        e => { console.log('onError: %o', e); },
        () => { console.log('Completed update.'); }
      );
    }

    // Navigate back to schedule view
    this.router.navigateByUrl('appointment');
  }

  private linkExaminationWithAppointment(appointment: Appointment, examination: Examination) {
    this.appointmentService.appointmentPrototypeLinkExaminations(
      examination.id.toString(),
      appointment.id.toString())
    .subscribe(
      x => console.log(`Linked examination ${x.examinationId} with appointment ${x.appointmentId}`),
      e => console.log(e),
      () => console.log('Completed linking examination with appointment.')
    );
  }

  private getAllRooms(): void {
    this.roomService
    .roomFind()
    .subscribe(
      x => this.rooms = x,
      e => console.log(e),
      () => console.log('Get all rooms complete.')
    );
  }

  private findPatients(event) {
    this.patientService
    .patientFind(`{"where": {"surname": {"regexp": "${event.query}/i"}}}`)
    .subscribe(
      x => this.filteredPatients = x,
      e => console.log(e),
      () => console.log('Completed querying for patients.')
    );
  }

  private findExaminations(event) {
    this.examinationService
    .examinationFind(`{"where": {"name": {"regexp": "${event.query}/i"}}}`)
    .subscribe(
      x => this.filteredExaminations = x,
      e => console.log(e),
      () => console.log('Completed querying for examinations.')
    );
  }

  private findTime(
    duration?: string,
    examinationId?: number,
    roomId?: number,
    startDate?: moment.Moment
  ) {
    console.log('Querying for the next free time slot.');
    this.appointmentService
    .appointmentFindTime(
      duration ? 'PT' + duration : 'PT40M', // TODO move to server and replace by config-default
      examinationId,
      roomId,
      startDate ? startDate.toDate() : undefined)
    .subscribe(
      x => this.proposedTimeSlots.push(x),
      e => console.log(e),
      () => console.log('Completed querying for the next free time slot.')
    );
  }

  private onFormChange() {
    // Set placeholder for examinations input
    for (let autoComplete of this.examsMultiInput.toArray()) {
      autoComplete.input.placeholder =
        localStorage.getItem('locale').startsWith('de') ?  'Behandlungen' : 'Examinations';
    }

     // Every time the form changes, use latest information to find a suitable date
    if (this.model.duration) {

      // Check if duration is valid
      let duration = moment.duration('PT' + this.model.duration);
      if (moment.isDuration(duration) && duration.asMinutes() > 1) {
        this.proposedTimeSlots = [];
        this.findTime(
          this.model.duration,
          this.model.examinations && this.model.examinations.length > 0 ?
            this.model.examinations[0].id : undefined,
          this.model.roomId,
          moment()
        );
        this.findTime(
          this.model.duration,
          this.model.examinations && this.model.examinations.length > 0 ?
            this.model.examinations[0].id : undefined,
          this.model.roomId,
          moment().add(1, 'day')
        );
        this.findTime(
          this.model.duration,
          this.model.examinations && this.model.examinations.length > 0 ?
            this.model.examinations[0].id : undefined,
          this.model.roomId,
          moment().add(1, 'week')
        );
        this.findTime(
          this.model.duration,
          this.model.examinations && this.model.examinations.length > 0 ?
            this.model.examinations[0].id : undefined,
          this.model.roomId,
          moment().add(1, 'month')
        );
      }
    }
  }

  private getRoomNameById(roomId: number) {
    for (let i = 0; i < this.rooms.length; i++) {
      if (this.rooms[i].id === roomId) {
        return this.rooms[i].name;
      }
    }
  }

  private getAppointmentById(id: number) {
    this.appointmentService.appointmentFindById(id.toString())
      .subscribe(
        x => {
          let startDate = moment(x.start);
          let endDate = moment(x.end);
          let duration = moment.duration(endDate.diff(startDate));
          this.model.id = x.id;
          this.model.date = startDate.format('l');
          this.model.time = startDate.format('LT');
          this.model.duration = duration.toJSON().substring(2);
          this.model.title = x.title;
          this.model.description = x.description;
          if (x.patientId) {
            this.patientService.patientFindById(x.patientId.toString())
              .subscribe(
                y => this.model.patient = y,
                e => console.log(e),
                () => console.log('Completed querying for patient by id')
              );
          }
          this.model.roomId = x.roomId;
          this.appointmentService.appointmentPrototypeGetExaminations(x.id.toString())
            .subscribe(
              z => this.model.examinations = z,
              e => console.log(e),
              () => console.log('Completed querying for examinations by appointment id')
            );
        },
        e => console.log(e),
        () => console.log('Completed querying for appointment data')
      );
  }

  private onDurationBlur(event: Event) {
    if (this.durationInput) {
      if (/^[0-9]$/.test(this.durationInput.value)) {
        this.durationInput.value = this.durationInput.value + 'H';
      } else if (/^[0-9]{2}$/.test(this.durationInput.value)) {
        this.durationInput.value = this.durationInput.value + 'M';
      } else {
        this.durationInput.value = this.durationInput.value.toUpperCase();
      }
      this.onFormChange();
    }
  }

  private applySuggestion(timeSlot: any) {
    if (timeSlot) {
      console.log(timeSlot);
      let startDate = moment(timeSlot.start);
      this.model.duration =
        `${moment.duration(timeSlot.duration, 'minutes').toJSON().substring(2)}`;
      this.model.date = startDate.format('l');
      this.model.time = startDate.format('LT');
      this.model.roomId = timeSlot.resources[0];

      // Clear suggestions
      this.proposedTimeSlots = [];
    }
  }

  private handleEditClick() {
    this.editing = true;
  }

  private formatDuration(durationString: string): string {
    return this.localeHumanizer(moment.duration('PT' + durationString).asMilliseconds());
  }

  private isCurrentLocaleUsingTwelveHours(): boolean {
    return moment().format('LT').endsWith('M');
  }
}

interface AppointmentViewModel {
  id: number;
  title: string;
  description: string;
  date: string;
  time: string;
  duration: string;
  roomId: number;
  patient: Patient;
  examinations: Examination[];
  reminders: boolean;
  smsReminder?: boolean;
  emailReminder?: boolean;
}
